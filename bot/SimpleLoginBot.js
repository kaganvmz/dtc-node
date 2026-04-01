import { chromium } from "playwright";

class ProxyBlockedError extends Error {
  constructor(message = "Proxy blocked by target site") {
    super(message);
    this.name = "ProxyBlockedError";
  }
}

const CONFIG = {
  TARGET_URL: "https://driverpracticaltest.dvsa.gov.uk/login",
  TIMEOUTS: {
    PAGE_LOAD: 30000,
    WEBSOCKET_CONNECT: 10000
  }
};

class SimpleLoginBot {
  constructor(multiloginCredentials, captchaApiKey, tasksApiToken, workerName) {
    this.multiloginCredentials = multiloginCredentials;
    this.captchaApiKey = captchaApiKey;
    this.tasksApiToken = tasksApiToken;
    this.workerName = workerName;

    this.multiloginAPI = null;
    this.captchaSolver = null;
    this.tasksAPI = null;
    this.isRunning = false;
    this.visualPauseMs = Number(process.env.DTC_VISUAL_PAUSE_MS || 0);
  }

  async visualPause(label) {
    if (!this.visualPauseMs || Number.isNaN(this.visualPauseMs) || this.visualPauseMs <= 0) {
      return;
    }

    console.log(`👀 Visual pause (${label}): ${this.visualPauseMs}ms`);
    await this.sleep(this.visualPauseMs);
  }

  async createProfile(profileName) {
    const reuseProfileName = this.multiloginAPI.browserProfileName || null;
    const searchProfileName = reuseProfileName || profileName;
    console.log(`🔍 Создание/поиск профиля: ${searchProfileName}`);

    try {
      const searchResult = await this.multiloginAPI.searchProfile(searchProfileName);
      const profiles = Array.isArray(searchResult?.data?.profiles) ? searchResult.data.profiles : [];
      const matchedProfile = profiles.find((profile) => profile?.name === searchProfileName);

      if (!matchedProfile) {
        console.log("📝 Создание нового профиля...");
        const currentProxy = this.multiloginAPI.getCurrentProxy();
        const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(currentProxy);
        console.log(`📤 Proxy for profile: ${formattedProxy.type}://${formattedProxy.host}:${formattedProxy.port}`);

        const createResult = await this.multiloginAPI.createProfile(
          profileName,
          formattedProxy,
          this.multiloginAPI.defaultBrowserType
        );

        if (createResult?.status?.http_code === 201 && Array.isArray(createResult?.data?.ids) && createResult.data.ids.length > 0) {
          const profileId = createResult.data.ids[0];
          console.log(`✅ Профиль создан с ID: ${profileId}`);

          const updateResult = await this.multiloginAPI.updateProfileProxy(profileId, formattedProxy);
          console.log(`📤 Proxy assignment result: http=${updateResult?.status?.http_code} msg=${updateResult?.status?.message || "-"}`);

          return profileId;
        }

        throw new Error(`Ошибка создания профиля: ${createResult?.status?.message || "Некорректный ответ API"}`);
      }

      const profileId = matchedProfile.id;
      console.log(`✅ Профиль найден с ID: ${profileId}`);
      return profileId;
    } catch (error) {
      throw new Error(`Ошибка работы с профилем: ${error.message}`);
    }
  }

  async launchBrowser(profileId) {
    console.log(`🌐 Запуск браузера для профиля ${profileId}...`);

    try {
      let startResult = await this.multiloginAPI.startProfile(profileId);

      const coreDownloadMaxRetries = 12;
      let coreRetry = 0;
      while (startResult.status.error_code === "CORE_DOWNLOADING_STARTED" && coreRetry < coreDownloadMaxRetries) {
        coreRetry++;
        console.log(`⏳ Core браузера скачивается... попытка ${coreRetry}/${coreDownloadMaxRetries}, ждём 10 сек...`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        startResult = await this.multiloginAPI.startProfile(profileId);
      }

      if (startResult.status.error_code === "CORE_DOWNLOADING_STARTED") {
        throw new Error("Core браузера не успел скачаться. Попробуйте позже.");
      }

      if (startResult.status.http_code !== 200 && startResult.status.error_code === "GET_PROXY_CONNECTION_IP_ERROR") {
        console.log("⚠️ Ошибка подключения к прокси, получаем новый...");

        const newProxyConfig = await this.multiloginAPI.rotateProxyAsync();
        const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(newProxyConfig);

        console.log("🔄 Обновляем профиль с новым прокси...");
        const updateResult = await this.multiloginAPI.updateProfileProxy(profileId, formattedProxy);
        console.log(`✅ Результат обновления прокси: http=${updateResult?.status?.http_code} msg=${updateResult?.status?.message || "-"}`);

        if (updateResult.status.http_code !== 200) {
          throw new Error(`Ошибка обновления прокси: ${updateResult.status.message}`);
        }

        console.log("🔄 Повторно запускаем профиль после обновления прокси...");
        startResult = await this.multiloginAPI.startProfile(profileId);
      }

      if (startResult?.status?.http_code !== 200) {
        throw new Error(startResult?.status?.message || "Не удалось запустить профиль");
      }

      if (!startResult?.data?.port) {
        throw new Error("Multilogin не вернул порт запущенного профиля");
      }

      const wsEndpoint = await this.getWebSocketEndpoint(startResult.data.port);
      console.log(`✅ WebSocket endpoint: ${wsEndpoint}`);

      const browser = await chromium.connectOverCDP(wsEndpoint, {
        timeout: CONFIG.TIMEOUTS.WEBSOCKET_CONNECT
      });

      console.log("✅ Браузер запущен и подключен");
      return browser;
    } catch (error) {
      throw new Error(`Ошибка запуска браузера: ${error.message}`);
    }
  }

  async getWebSocketEndpoint(port) {
    const maxRetries = 10;
    const retryDelay = 2000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();
        if (json.webSocketDebuggerUrl) {
          return json.webSocketDebuggerUrl;
        }
      } catch (error) {
        console.warn(`Попытка ${i + 1}/${maxRetries} не удалась: ${error.message}`);
        if (i < maxRetries - 1) {
          await this.sleep(retryDelay);
        }
      }
    }

    throw new Error("Не удалось получить WebSocket endpoint");
  }

  async navigateToPage(browser) {
    console.log("📄 Навигация на целевую страницу...");

    try {
      const contexts = browser.contexts();
      const pages = contexts[0].pages();
      const page = pages[0];

      await page.goto(CONFIG.TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.TIMEOUTS.PAGE_LOAD
      });

      await this.sleep(2000);
      await this.visualPause("login page");

      return page;
    } catch (error) {
      throw new Error(`Ошибка навигации: ${error.message}`);
    }
  }

  async isQueueItPage(page) {
    try {
      const currentUrl = page.url();
      if (currentUrl.includes("queue.driverpracticaltest.dvsa.gov.uk")) {
        return true;
      }

      const pageTitle = await page.title().catch(() => "");
      if (pageTitle.includes("Queue-it")) {
        return true;
      }

      return await page.evaluate(() => {
        const body = document.body;
        if (!body) {
          return false;
        }

        return body.dataset.pageid === "queue" || body.classList.contains("queue");
      });
    } catch {
      return false;
    }
  }

  async waitForQueueRedirect(page, timeoutMs = 180000) {
    if (!(await this.isQueueItPage(page))) {
      return;
    }

    console.log("⏳ Queue-it detected, waiting for redirect...");
    const startedAt = Date.now();
    let lastUsersAhead = null;

    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isQueueItPage(page))) {
        console.log(`✅ Queue-it redirect completed: ${page.url()}`);
        await this.sleep(3000);
        return;
      }

      const queueState = await page.evaluate(() => {
        const usersAhead =
          document.querySelector("[data-bind*='usersInLineAheadOfYou']")?.textContent?.trim() ||
          document.querySelector("#MainPart_lbUsersInLineAheadOfYou")?.textContent?.trim() ||
          null;
        const body = document.body;

        return {
          pageId: body?.dataset?.pageid || null,
          pageClass: body?.className || null,
          usersAhead
        };
      }).catch(() => ({ pageId: null, pageClass: null, usersAhead: null }));

      if (queueState.usersAhead && queueState.usersAhead !== lastUsersAhead) {
        lastUsersAhead = queueState.usersAhead;
        console.log(`⏳ Queue-it status: users ahead ${queueState.usersAhead}`);
      }

      await this.sleep(2000);
    }

    throw new Error("Queue-it redirect timeout");
  }

  async isImpervaInterstitialPage(page) {
    try {
      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => "");

      return await page.evaluate(({ currentUrl, pageTitle }) => {
        const bodyText = document.body?.innerText || "";
        const hasInterstitial = Boolean(document.querySelector("#interstitial-inprogress"));
        const hasPardonHeader = bodyText.includes("Pardon Our Interruption");
        const hasStandBy = bodyText.includes("Please stand by");
        const hasProtectionScript = Array.from(document.querySelectorAll("script[src]")).some((script) => {
          const src = script.getAttribute("src") || "";
          return src.includes("AAWS4Fk4") || src.includes("any-with-Green-euery-Swortune");
        });

        return (
          pageTitle.includes("Pardon Our Interruption") ||
          currentUrl.includes("/manage") && (hasInterstitial || hasPardonHeader || hasStandBy || hasProtectionScript)
        );
      }, { currentUrl, pageTitle });
    } catch {
      return false;
    }
  }

  async waitForImpervaInterstitial(page, timeoutMs = 30000) {
    if (!(await this.isImpervaInterstitialPage(page))) {
      return false;
    }

    console.log("⏳ Imperva interstitial detected, waiting for auto-redirect...");
    await this.visualPause("imperva interstitial");
    const startedAt = Date.now();
    let lastUrl = page.url();

    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isImpervaInterstitialPage(page))) {
        console.log(`✅ Imperva interstitial finished: ${page.url()}`);
        await this.sleep(3000);
        return true;
      }

      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log(`📍 Interstitial URL: ${currentUrl}`);
      }

      await this.sleep(2000);
    }

    console.log("⚠️ Imperva interstitial did not finish in time");
    return false;
  }

  async isLoginPageReady(page) {
    try {
      return await page.evaluate(() => {
        const bodyId = document.body?.id || "";
        const hasLicence = Boolean(document.querySelector("#driving-licence-number"));
        const hasReference = Boolean(document.querySelector("#application-reference-number"));
        const hasButton = Boolean(document.querySelector("#booking-login"));

        return bodyId === "page-login" || (hasLicence && hasReference && hasButton);
      });
    } catch {
      return false;
    }
  }

  async checkForIncapsula(page) {
    try {
      await page.waitForSelector("#main-iframe", { timeout: 5000 });
      console.log("🛡️ Incapsula challenge обнаружен");
      return true;
    } catch {
      console.log("ℹ️ Incapsula challenge не обнаружен");
      return false;
    }
  }

  async detectIncapsulaPageType(page) {
    const inspectHtml = (html) => {
      if (!html || typeof html !== "string") {
        return null;
      }

      const hasSolvableChallengeMarker =
        html.includes("_Incapsula_Resource?SWJIYLWA=") ||
        html.includes("SWJIYLWA=");

      const blockedMarkers = [
        "CWUDNSAI=",
        "edet=15",
        "edet=16",
        "incident_id=",
        "[Error Title]",
        "Request unsuccessful. Incapsula incident ID",
        "Error 15",
        "Error 16"
      ];

      const hasBlockedMarker = blockedMarkers.some((marker) => html.includes(marker));

      if (hasSolvableChallengeMarker) {
        return "captcha";
      }

      if (hasBlockedMarker) {
        return "blocked";
      }

      return null;
    };

    try {
      const mainHtml = await page.content().catch(() => "");
      const mainType = inspectHtml(mainHtml);
      if (mainType) {
        return mainType;
      }

      const iframeEl = await page.$("#main-iframe");
      if (!iframeEl) {
        return null;
      }

      const iframeFrame = await iframeEl.contentFrame();
      if (!iframeFrame) {
        return null;
      }

      const iframeHtml = await iframeFrame.evaluate(() => document.documentElement.outerHTML).catch(() => "");
      return inspectHtml(iframeHtml);
    } catch {
      return null;
    }
  }

  async bypassIncapsula(page, options = {}) {
    try {
      const pageTypeBeforeSolve = await this.detectIncapsulaPageType(page);
      if (pageTypeBeforeSolve === "blocked") {
        throw new ProxyBlockedError("DVSA/Incapsula blocked the current proxy. Rotate proxy and restart the profile.");
      }

      console.log("🛡️ Запуск обхода Incapsula через CapMonster...");
      await this.visualPause("before bypass");

      const pageTypeAfterPause = await this.detectIncapsulaPageType(page);
      if (pageTypeAfterPause === "blocked") {
        throw new ProxyBlockedError("DVSA/Incapsula blocked the current proxy. Rotate proxy and restart the profile.");
      }

      try {
        const ipPage = await page.context().newPage();
        await ipPage.goto("https://api.ipify.org?format=json", { timeout: 10000 });
        const ipData = await ipPage.evaluate(() => document.body.innerText);
        console.log(`🌍 IP браузера: ${ipData}`);
        await ipPage.close();
      } catch (error) {
        console.log(`⚠️ Не удалось проверить IP браузера: ${error.message}`);
      }

      let incapsulaScriptUrl = null;
      let challengeScriptUrl = null;
      let incapsulaScriptBase64 = null;
      const swjiylwaSearchStart = Date.now();
      let iframeErrorPageLogged = false;

      const extractChallengeScriptUrl = async (frame) => {
        try {
          return await frame.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll("script[src]"));
            const candidate = scripts.find((script) => {
              const src = script.getAttribute("src") || "";
              if (!src) {
                return false;
              }

              if (src.includes("_Incapsula_Resource")) {
                return false;
              }

              if (src.includes("/resources/")) {
                return false;
              }

              if (src.includes("jquery") || src.includes("respond.js") || src.includes("govuk-template")) {
                return false;
              }

              return true;
            });

            return candidate ? candidate.getAttribute("src") : null;
          });
        } catch {
          return null;
        }
      };

      const extractSwjiylwa = async (frame) => {
        try {
          return await frame.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll("script[src]"));
            const found = scripts.find((script) => script.src.includes("SWJIYLWA"));
            if (found) {
              try {
                const url = new URL(found.src);
                return url.pathname.substring(1) + url.search;
              } catch {
                return found.src;
              }
            }

            const entries = performance.getEntriesByType("resource");
            const entry = entries.find((resource) => resource.name.includes("SWJIYLWA"));
            if (entry) {
              try {
                const url = new URL(entry.name);
                return url.pathname.substring(1) + url.search;
              } catch {
                return null;
              }
            }

            const match = document.documentElement.outerHTML.match(/_Incapsula_Resource\?SWJIYLWA=[^"'\s<]*/);
            return match ? match[0] : null;
          });
        } catch {
          return null;
        }
      };

      while ((!incapsulaScriptUrl || !challengeScriptUrl) && Date.now() - swjiylwaSearchStart < 15000) {
        incapsulaScriptUrl = await extractSwjiylwa(page.mainFrame());
        challengeScriptUrl = await extractChallengeScriptUrl(page.mainFrame());

        if (!incapsulaScriptUrl || !challengeScriptUrl) {
          try {
            const iframeEl = await page.$("#main-iframe");
            if (iframeEl) {
              const iframeFrame = await iframeEl.contentFrame();
              if (iframeFrame) {
                await iframeFrame.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
                incapsulaScriptUrl = incapsulaScriptUrl || await extractSwjiylwa(iframeFrame);
                challengeScriptUrl = challengeScriptUrl || await extractChallengeScriptUrl(iframeFrame);
                if (!incapsulaScriptUrl && !challengeScriptUrl) {
                  const iframeHtml = await iframeFrame.evaluate(() => document.documentElement.outerHTML).catch(() => "");
                  if (iframeHtml && !iframeErrorPageLogged) {
                    iframeErrorPageLogged = true;
                    console.log("📄 Incapsula iframe error page detected");
                  }
                }
              }
            }
          } catch {
            // ignore iframe extraction errors
          }
        }

        if (!incapsulaScriptUrl) {
          await this.sleep(2000);
        }
      }

      const currentHtml = await page.content().catch(() => "");
      this.#throwIfProxyBlockedHtml(currentHtml);

      console.log(`📤 incapsulaScriptUrl: ${incapsulaScriptUrl || "НЕ НАЙДЕН"}`);
      console.log(`📤 challengeScriptUrl: ${challengeScriptUrl || "НЕ НАЙДЕН"}`);
      if (!challengeScriptUrl && !incapsulaScriptUrl) {
        const html = await page.content();
        const summary = {
          edet: html.match(/edet=(\d+)/)?.[1] || null,
          incidentId: html.match(/incident_id=([^&"\s<]+)/)?.[1] || null,
          cip: html.match(/cip=([^&"\s<]+)/)?.[1] || null
        };
        console.log(`📄 Incapsula page summary: ${JSON.stringify(summary)}`);
        this.#throwIfProxyBlockedHtml(html);
        throw new Error("Не удалось найти challenge script для Incapsula на странице");
      }

      const scriptUrlToFetch = challengeScriptUrl || incapsulaScriptUrl;
      try {
        const scriptResponse = await page.goto(new URL(scriptUrlToFetch, page.url()).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 15000
        });
        const scriptText = await scriptResponse.text();
        incapsulaScriptBase64 = Buffer.from(scriptText, "utf8").toString("base64");
      } catch (error) {
        throw new Error(`Не удалось получить Incapsula script content: ${error.message}`);
      } finally {
        await page.goto("https://driverpracticaltest.dvsa.gov.uk/login", {
          waitUntil: "domcontentloaded",
          timeout: CONFIG.TIMEOUTS.PAGE_LOAD
        });
        await this.sleep(2000);
      }

      if (!incapsulaScriptBase64) {
        throw new Error("Incapsula script content is empty");
      }

      const allCookies = await page.context().cookies();
      const sessionCookie = allCookies.find((cookie) => cookie.name.startsWith("incap_ses_"));
      const incapsulaCookies = allCookies
        .filter((cookie) => cookie.name.startsWith("incap_ses_") || cookie.name.startsWith("visid_incap_"))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      const incapsulaSessionCookie = sessionCookie ? `${sessionCookie.name}=${sessionCookie.value}` : null;

      console.log(`📤 incapsulaSessionCookie: ${incapsulaSessionCookie ? `${incapsulaSessionCookie.substring(0, 80)}...` : "НЕ НАЙДЕН"}`);
      if (!incapsulaSessionCookie) {
        throw new Error("Не удалось найти session cookie Incapsula (incap_ses_*)");
      }

      const reese84UrlEndpoint = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource");
        const reese = entries.find((entry) => {
          try {
            const url = new URL(entry.name);
            return url.search.includes("?d=") && !url.pathname.includes("_Incapsula_Resource");
          } catch {
            return false;
          }
        });

        if (reese) {
          try {
            const url = new URL(reese.name);
            return url.pathname.substring(1);
          } catch {
            return null;
          }
        }

        return null;
      });

      if (reese84UrlEndpoint) {
        console.log(`📤 reese84UrlEndpoint: ${reese84UrlEndpoint}`);
      } else {
        console.log("ℹ️ reese84UrlEndpoint не найден (опциональный параметр)");
      }

      const currentProxy = this.multiloginAPI.getCurrentProxy();
      console.log(`📤 proxy: ${currentProxy.type}://${currentProxy.host}:${currentProxy.port}`);
      console.log(`📤 proxy username: ${currentProxy.username}`);

      const userAgent = await page.evaluate(() => navigator.userAgent);

      const metadata = {
        incapsulaScriptUrl,
        incapsulaScriptBase64,
        incapsulaCookies,
        incapsulaSessionCookie
      };
      if (reese84UrlEndpoint) {
        metadata.reese84UrlEndpoint = reese84UrlEndpoint;
      }

      const solution = await this.captchaSolver.solve(
        page.url(),
        userAgent,
        metadata,
        currentProxy,
        options
      );

      console.log("✅ CapMonster solution received");

      const existingCookies = await page.context().cookies();
      const incapCookieNames = existingCookies
        .filter((cookie) => /^(incap_ses_|visid_incap_|___utmvc|reese84)/.test(cookie.name))
        .map((cookie) => cookie.name);
      if (incapCookieNames.length > 0) {
        console.log(`🗑️ Удаляем ${incapCookieNames.length} старых Incapsula cookies: ${incapCookieNames.join(", ")}`);
        await page.context().clearCookies({ name: new RegExp("^(incap_ses_|visid_incap_|___utmvc|reese84)") });
      }

      console.log("Инжектим cookies...");

      const domains = solution.domains || solution;
      const domainKeys = typeof domains === "object" && domains !== null ? Object.keys(domains) : [];
      console.log(`📦 Solution domains: ${domainKeys.length > 0 ? domainKeys.join(", ") : "none"}`);
      let cookiesInjected = 0;

      for (const [domainKey, domainData] of Object.entries(domains)) {
        const cookies = domainData.cookies || domainData;
        console.log(`🍪 Applying cookies for: ${domainKey}`);
        for (const [cookieName, cookieValue] of Object.entries(cookies)) {
          const value = cookieValue.split(";")[0].trim();
          await page.context().addCookies([{
            name: cookieName,
            value,
            domain: ".driverpracticaltest.dvsa.gov.uk",
            path: "/",
            secure: true,
            sameSite: "None"
          }]);
          cookiesInjected++;
        }
      }

      if (cookiesInjected === 0) {
        throw new Error("CapMonster не вернул cookies в решении");
      }

      const allCookiesAfter = await page.context().cookies();
      const incapCookiesAfter = allCookiesAfter.filter((cookie) => /incap|utmvc|reese84|nlbi/.test(cookie.name));
      console.log(`✅ Injected ${cookiesInjected} cookies; active: ${incapCookiesAfter.map((cookie) => cookie.name).join(", ")}`);
      await this.visualPause("after cookies injected");

      const targetURL = page.url();
      console.log(`🔄 Навигация на ${targetURL}...`);
      await page.goto(targetURL, { waitUntil: "networkidle", timeout: CONFIG.TIMEOUTS.PAGE_LOAD });
      await this.sleep(8000);
      await this.visualPause("after bypass navigation");

      const pageContent = await page.content();
      if (pageContent.includes("Access Denied") || pageContent.includes("Error 15") || pageContent.includes("Error 16")) {
        const errorMatch = pageContent.match(/Error (\d+)/);
        const errorNum = errorMatch ? errorMatch[1] : "unknown";
        console.log(`🚫 DVSA Access Denied (Error ${errorNum}) — IP заблокирован`);
        throw new ProxyBlockedError(`DVSA заблокировал IP (Error ${errorNum}). Нужна ротация прокси.`);
      }

      const stillBlocked = await this.checkForIncapsula(page);
      if (stillBlocked) {
        console.log(`📍 URL после reload: ${page.url()}`);
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300));
        console.log(`📄 Контент страницы: ${bodyText}`);
        console.log(`📄 Bypass metadata: scriptBase64=${metadata.incapsulaScriptBase64 ? "present" : "missing"} reese=${metadata.reese84UrlEndpoint || "none"}`);
        this.#throwIfProxyBlockedHtml(pageContent);
        throw new Error("Incapsula bypass не удался — challenge всё ещё присутствует после инъекции cookies");
      }

      console.log("✅ Incapsula bypass успешен!");
    } catch (error) {
      console.error("❌ Ошибка обхода Incapsula:", error.message);
      throw error;
    }
  }

  #throwIfProxyBlockedHtml(html) {
    if (!html || typeof html !== "string") {
      return;
    }

    const hasSolvableChallengeMarker =
      html.includes("_Incapsula_Resource?SWJIYLWA=") ||
      html.includes("SWJIYLWA=");

    if (hasSolvableChallengeMarker) {
      return;
    }

    const blockedMarkers = [
      "CWUDNSAI=",
      "edet=15",
      "edet=16",
      "incident_id=",
      "[Error Title]",
      "Request unsuccessful. Incapsula incident ID",
      "Error 15",
      "Error 16"
    ];

    if (blockedMarkers.some((marker) => html.includes(marker))) {
      throw new ProxyBlockedError("DVSA/Incapsula blocked the current proxy. Rotate proxy and restart the profile.");
    }
  }

  async checkLoginForm(page) {
    try {
      await this.waitForQueueRedirect(page);

      console.log("🔄 Ожидание полной загрузки всех скриптов...");

      await page.waitForLoadState("networkidle", { timeout: 15000 });

      await page.waitForFunction(() => {
        return typeof window.jQuery !== "undefined" &&
               document.readyState === "complete" &&
               !document.querySelector(".loading") &&
               window.jQuery &&
               window.jQuery.isReady;
      }, { timeout: 10000 });

      await this.sleep(3000);

      console.log("✅ Скрипты загружены, проверяем форму...");

      await page.waitForSelector("#driving-licence-number", { timeout: 10000, state: "visible" });
      await page.waitForSelector("#application-reference-number", { timeout: 10000, state: "visible" });
      await page.waitForSelector("#booking-login", { timeout: 10000, state: "visible" });

      const licenseField = await page.locator("#driving-licence-number").isVisible({ timeout: 3000 });
      const referenceField = await page.locator("#application-reference-number").isVisible({ timeout: 3000 });
      const loginButton = await page.locator("#booking-login").isVisible({ timeout: 3000 });

      const licenseEnabled = licenseField ? await page.locator("#driving-licence-number").isEnabled() : false;
      const referenceEnabled = referenceField ? await page.locator("#application-reference-number").isEnabled() : false;
      const loginEnabled = loginButton ? await page.locator("#booking-login").isEnabled() : false;

      console.log(`📝 Элементы формы: лицензия=${licenseField}(${licenseEnabled}), референс=${referenceField}(${referenceEnabled}), кнопка=${loginButton}(${loginEnabled})`);

      return licenseField && referenceField && loginButton && licenseEnabled && referenceEnabled && loginEnabled;
    } catch (error) {
      console.warn("⚠️ Ошибка проверки формы логина:", error.message);

      try {
        const currentUrl = page.url();
        console.log(`🔍 Текущий URL: ${currentUrl}`);

        const pageTitle = await page.title();
        console.log(`📄 Заголовок страницы: ${pageTitle}`);

        if (await this.isQueueItPage(page)) {
          console.log("ℹ️ Login form is not expected yet: still on Queue-it page");
        }

        const licenseExists = await page.locator("#driving-licence-number").count();
        const referenceExists = await page.locator("#application-reference-number").count();
        const loginExists = await page.locator("#booking-login").count();

        console.log(`🔍 Элементы в DOM: лицензия=${licenseExists}, референс=${referenceExists}, кнопка=${loginExists}`);
      } catch (debugError) {
        console.warn("⚠️ Ошибка получения отладочной информации:", debugError.message);
      }

      return false;
    }
  }

  async humanTyping(page, selector, text, options = {}) {
    try {
      console.log(`⌨️ Человекоподобная печать с опечатками для селектора: ${selector}`);
      const typoChance = options.typoChance ?? 0.05;
      const pauseChance = options.pauseChance ?? 0.1;

      await this.moveMouseToElement(page, selector);
      await page.click(selector);
      await this.randomDelay(100, 200);

      await page.fill(selector, "");
      await this.randomDelay(50, 100);

      for (let i = 0; i < text.length; i++) {
        const currentChar = text[i];

        if (Math.random() < typoChance && i > 0 && i < text.length - 1) {
          await this.makeTypingMistake(page, selector, text, i);
          continue;
        }

        await page.keyboard.type(currentChar);

        const delay = Math.random() * 150 + 50;
        await this.sleep(delay);

        if (Math.random() < pauseChance) {
          await this.sleep(Math.random() * 500 + 200);
        }
      }

      console.log("✅ Человекоподобная печать с опечатками завершена");
    } catch (error) {
      console.warn(`⚠️ Ошибка человекоподобной печати для ${selector}:`, error.message);
      throw error;
    }
  }

  async moveMouseToElement(page, selector) {
    try {
      const element = await page.locator(selector);
      const box = await element.boundingBox();

      if (box) {
        const x = box.x + Math.random() * box.width;
        const y = box.y + Math.random() * box.height;

        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
        await this.randomDelay(50, 150);
      }
    } catch (error) {
      console.warn(`⚠️ Ошибка движения мыши к элементу ${selector}:`, error.message);
    }
  }

  async humanClick(page, selector) {
    try {
      console.log(`🖱️ Человекоподобный клик по селектору: ${selector}`);

      await this.moveMouseToElement(page, selector);
      await this.randomDelay(100, 300);

      await page.mouse.down();
      await this.sleep(Math.random() * 100 + 50);
      await page.mouse.up();

      console.log("✅ Человекоподобный клик выполнен");
    } catch (error) {
      console.warn(`⚠️ Ошибка человекоподобного клика по ${selector}:`, error.message);
      throw error;
    }
  }

  async validateFieldContent(page, selector, expectedValue) {
    try {
      const actualValue = await page.inputValue(selector);
      const isValid = actualValue === expectedValue;

      console.log(`${isValid ? "✅" : "❌"} Валидация поля ${selector}: ожидалось "${expectedValue}", получено "${actualValue}"`);

      if (!isValid) {
        console.warn(`⚠️ Поле ${selector} содержит неправильное значение. Попытка исправления...`);
        await page.fill(selector, expectedValue);
        await this.randomDelay(200, 400);

        const correctedValue = await page.inputValue(selector);
        console.log(`🔄 После исправления значение поля ${selector}: "${correctedValue}"`);
      }

      return isValid;
    } catch (error) {
      console.warn(`⚠️ Ошибка валидации поля ${selector}:`, error.message);
      return false;
    }
  }

  async makeTypingMistake(page, selector, text, currentIndex) {
    try {
      const currentChar = text[currentIndex];
      const mistakeType = Math.random();

      console.log(`🔤 Делаем опечатку на позиции ${currentIndex} (символ: "${currentChar}")`);

      if (mistakeType < 0.4) {
        await this.swapCharactersMistake(page, text, currentIndex);
      } else if (mistakeType < 0.7) {
        await this.wrongCharacterMistake(page, currentChar);
      } else {
        await this.doubleCharacterMistake(page, currentChar);
      }
    } catch (error) {
      console.warn("⚠️ Ошибка при создании опечатки:", error.message);
      await page.keyboard.type(text[currentIndex]);
    }
  }

  async swapCharactersMistake(page, text, currentIndex) {
    const currentChar = text[currentIndex];
    const nextChar = text[currentIndex + 1];

    if (!nextChar) {
      return;
    }

    console.log(`🔄 Перестановка символов: "${currentChar}${nextChar}" → "${nextChar}${currentChar}"`);

    await page.keyboard.type(nextChar);
    await this.randomDelay(50, 150);
    await page.keyboard.type(currentChar);

    await this.randomDelay(300, 800);
    console.log("🤔 Замечаем опечатку...");

    await page.keyboard.press("Backspace");
    await this.randomDelay(100, 200);
    await page.keyboard.press("Backspace");
    await this.randomDelay(100, 300);

    console.log("✍️ Исправляем опечатку...");
    await page.keyboard.type(currentChar);
    await this.randomDelay(80, 180);
    await page.keyboard.type(nextChar);

    console.log("✅ Опечатка исправлена");
  }

  async wrongCharacterMistake(page, correctChar) {
    const similarChars = {
      a: ["s", "q", "w"], s: ["a", "d", "w"], d: ["s", "f", "e"], f: ["d", "g", "r"],
      g: ["f", "h", "t"], h: ["g", "j", "y"], j: ["h", "k", "u"], k: ["j", "l", "i"],
      l: ["k", "o", "p"], q: ["w", "a"], w: ["q", "e", "s"], e: ["w", "r", "d"],
      r: ["e", "t", "f"], t: ["r", "y", "g"], y: ["t", "u", "h"], u: ["y", "i", "j"],
      i: ["u", "o", "k"], o: ["i", "p", "l"], p: ["o", "l"], z: ["x", "a"], x: ["z", "c"],
      c: ["x", "v"], v: ["c", "b"], b: ["v", "n"], n: ["b", "m"], m: ["n"],
      0: ["9", "1"], 1: ["0", "2"], 2: ["1", "3"], 3: ["2", "4"], 4: ["3", "5"],
      5: ["4", "6"], 6: ["5", "7"], 7: ["6", "8"], 8: ["7", "9"], 9: ["8", "0"]
    };

    const lowerChar = correctChar.toLowerCase();
    const possibleMistakes = similarChars[lowerChar] || ["x", "z"];
    const wrongChar = possibleMistakes[Math.floor(Math.random() * possibleMistakes.length)];

    console.log(`❌ Неправильный символ: "${correctChar}" → "${wrongChar}"`);

    await page.keyboard.type(wrongChar);
    await this.randomDelay(400, 900);
    console.log("🤔 Замечаем неправильный символ...");

    await page.keyboard.press("Backspace");
    await this.randomDelay(150, 300);

    console.log("✍️ Исправляем символ...");
    await page.keyboard.type(correctChar);

    console.log("✅ Символ исправлен");
  }

  async doubleCharacterMistake(page, correctChar) {
    console.log(`⌨️ Двойное нажатие символа: "${correctChar}"`);

    await page.keyboard.type(correctChar);
    await this.randomDelay(30, 80);
    await page.keyboard.type(correctChar);

    await this.randomDelay(350, 700);
    console.log("🤔 Замечаем двойной символ...");

    await page.keyboard.press("Backspace");
    await this.randomDelay(100, 250);

    console.log("✅ Лишний символ удален");
  }

  async randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    console.log(`⏱️ Случайная задержка: ${delay}ms`);
    await this.sleep(delay);
  }

  async waitForInterstitialToDisappear(page) {
    const maxAttempts = 3;
    const waitTime = 10000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔄 Попытка ${attempt}/${maxAttempts}: ожидание исчезновения промежуточной страницы...`);

      try {
        await page.waitForSelector("#interstitial-inprogress", {
          state: "hidden",
          timeout: waitTime
        });

        console.log("✅ Промежуточная страница исчезла!");
        return;
      } catch {
        console.log(`⚠️ Промежуточная страница все еще видна (попытка ${attempt}/${maxAttempts})`);

        if (attempt < maxAttempts) {
          console.log("🔄 Перезагружаем страницу...");
          await page.reload({ waitUntil: "domcontentloaded" });
          await this.sleep(3000);
        }
      }
    }

    console.log("❌ Промежуточная страница не исчезла после 3 попыток, продолжаем...");
  }

  async waitForManagePageResult(page, timeoutMs = 30000) {
    console.log("⏳ Ожидание финального состояния страницы после логина...");
    const startedAt = Date.now();
    let lastUrl = null;

    while (Date.now() - startedAt < timeoutMs) {
      await this.waitForImpervaInterstitial(page, Math.min(30000, timeoutMs));
      await this.waitForQueueRedirect(page, Math.min(30000, timeoutMs));

      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log(`📍 Post-login URL: ${currentUrl}`);
      }

      const loginError = await this.checkForLoginError(page);
      if (loginError.hasError) {
        return {
          state: "login_error",
          message: loginError.message,
          errorType: loginError.type
        };
      }

      const loginPageReady = await this.isLoginPageReady(page);
      if (loginPageReady) {
        return {
          state: "login_page",
          message: "Returned to login page after authentication flow"
        };
      }

      const hasCaptcha = await this.checkForIncapsula(page);
      if (hasCaptcha) {
        return {
          state: "captcha"
        };
      }

      const isViewBookingPage = await this.checkViewBookingPage(page);
      if (isViewBookingPage) {
        return {
          state: "view_booking"
        };
      }

      await this.sleep(2000);
    }

    return {
      state: "timeout",
      message: "Timed out waiting for final post-login page"
    };
  }

  async checkViewBookingPage(page) {
    try {
      console.log("🔍 Проверка страницы View booking...");

      const viewBookingHeader = await page.locator('h1:has-text("View booking")').isVisible({ timeout: 5000 });
      const bodyId = await page.evaluate(() => document.body.id);
      const correctBodyId = bodyId === "page-ibs-summary";
      const testCentreButton = await page.locator("#test-centre-change").isVisible({ timeout: 3000 }).catch(() => false);
      const bookingDetailsSection = await page.locator("#confirm-booking-details").isVisible({ timeout: 3000 }).catch(() => false);
      const signOutButton = await page.locator('a:has-text("Sign out")').isVisible({ timeout: 3000 }).catch(() => false);

      console.log(`📊 View booking проверки: заголовок=${viewBookingHeader}, body id=${correctBodyId}, test-centre=${testCentreButton}, details=${bookingDetailsSection}, signout=${signOutButton}`);

      const hasStableBookingUi = testCentreButton || bookingDetailsSection || signOutButton;
      const isViewBookingPage = viewBookingHeader && correctBodyId && hasStableBookingUi;

      if (isViewBookingPage) {
        console.log("✅ Успешно попали на страницу View booking");
      } else {
        console.log("❌ Страница View booking не найдена или неполная");
      }

      return isViewBookingPage;
    } catch (error) {
      console.warn(`⚠️ Ошибка проверки страницы View booking: ${error.message}`);
      return false;
    }
  }

  async checkForLoginError(page) {
    try {
      console.log("🔍 Проверка наличия ошибок логина...");

      const errorSection = await page.locator(".validation-summary-errors").isVisible({ timeout: 3000 });

      if (errorSection) {
        console.log("❌ Обнаружена секция с ошибками");

        const errorText = await page.locator(".validation-summary-errors ul li").textContent({ timeout: 2000 });
        console.log(`📝 Текст ошибки: ${errorText}`);

        if (errorText && (
          errorText.includes("A booking can't be found") ||
          errorText.includes("booking cannot be found") ||
          errorText.includes("invalid") ||
          errorText.includes("not found")
        )) {
          return {
            hasError: true,
            message: errorText.trim(),
            type: "invalid_credentials"
          };
        }

        return {
          hasError: true,
          message: errorText ? errorText.trim() : "Неизвестная ошибка логина",
          type: "unknown_login_error"
        };
      }

      const commonErrorSelectors = [
        ".error-message",
        ".alert-danger",
        ".validation-error",
        '[role="alert"]',
        ".field-validation-error"
      ];

      for (const selector of commonErrorSelectors) {
        const errorElement = await page.locator(selector).isVisible({ timeout: 1000 });
        if (errorElement) {
          const errorText = await page.locator(selector).textContent({ timeout: 1000 });
          console.log(`❌ Найдена ошибка через селектор ${selector}: ${errorText}`);

          return {
            hasError: true,
            message: errorText ? errorText.trim() : "Ошибка логина",
            type: "validation_error"
          };
        }
      }

      console.log("✅ Ошибок логина не обнаружено");
      return { hasError: false };
    } catch (error) {
      console.warn(`⚠️ Ошибка при проверке ошибок логина: ${error.message}`);
      return { hasError: false };
    }
  }

  async cleanup(browser, profileId) {
    console.log("🧹 Очистка ресурсов...");

    try {
      if (browser) {
        await browser.close();
        console.log("✅ Браузер закрыт");
      }
    } catch (error) {
      console.warn("⚠️ Ошибка закрытия браузера:", error.message);
    }

    try {
      if (profileId && this.multiloginAPI) {
        await this.multiloginAPI.stopProfile(profileId);
        console.log("✅ Профиль остановлен");
      }
    } catch (error) {
      if (error.message?.includes("profile already stopped")) {
        console.log("ℹ️ Профиль уже был остановлен");
        return;
      }

      console.warn("⚠️ Ошибка остановки профиля:", error.message);
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop() {
    console.log("⏹️ Остановка бота...");
    this.isRunning = false;
  }
}

export { ProxyBlockedError, SimpleLoginBot };
