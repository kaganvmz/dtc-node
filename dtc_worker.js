import dotenv from "dotenv";
import { ProxyBlockedError, SimpleLoginBot } from "./bot/SimpleLoginBot.js";
import { DtcLoginAPI } from "./api/DtcLoginAPI.js";

dotenv.config();

class DtcLoginWorker extends SimpleLoginBot {
  constructor() {
    const config = DtcLoginWorker.#loadConfigFromEnv();
    super(config.multiloginCredentials, config.captchaApiKey, "dtc-worker", config.workerName);
    this.dtcLoginAPI = null;
    this.pollIntervalMs = config.pollIntervalMs;
    this.bypassAttempts = config.bypassAttempts;
  }

  static #loadConfigFromEnv() {
    const multiloginEmail = process.env.MULTILOGIN_EMAIL;
    const multiloginPassword = process.env.MULTILOGIN_PASSWORD;
    const captchaApiKey = process.env.CAPMONSTER_API_KEY;
    const workerName = process.env.WORKER_NAME || "dtc-worker-1";
    const pollIntervalMs = Number(process.env.DTC_POLL_INTERVAL_MS || 5000);

    if (!multiloginEmail) {
      throw new Error("MULTILOGIN_EMAIL is required");
    }

    if (!multiloginPassword) {
      throw new Error("MULTILOGIN_PASSWORD is required");
    }

    if (!captchaApiKey) {
      throw new Error("CAPMONSTER_API_KEY is required");
    }

    if (Number.isNaN(pollIntervalMs) || pollIntervalMs < 0) {
      throw new Error("DTC_POLL_INTERVAL_MS must be a non-negative number");
    }

    const bypassAttempts = Number(process.env.DTC_BYPASS_ATTEMPTS || 2);
    if (Number.isNaN(bypassAttempts) || bypassAttempts < 1) {
      throw new Error("DTC_BYPASS_ATTEMPTS must be a positive number");
    }

    return {
      multiloginCredentials: {
        email: multiloginEmail,
        password: multiloginPassword
      },
      captchaApiKey,
      workerName,
      pollIntervalMs,
      bypassAttempts
    };
  }

  async attemptBypassWithRetries(page, stageLabel) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.bypassAttempts; attempt++) {
      try {
        console.log(`🛡️ ${stageLabel}: попытка bypass ${attempt}/${this.bypassAttempts}...`);
        await this.bypassIncapsula(page);
        console.log(`✅ ${stageLabel}: bypass успешен на попытке ${attempt}`);
        return;
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ ${stageLabel}: bypass не удался на попытке ${attempt}: ${error.message}`);

        if (error instanceof ProxyBlockedError) {
          break;
        }

        if (attempt >= this.bypassAttempts) {
          break;
        }

        console.log(`🔄 ${stageLabel}: пробуем обновить страницу и повторить bypass...`);
        await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 30000 });
        await this.sleep(3000);
      }
    }

    throw lastError || new Error(`${stageLabel}: bypass failed`);
  }

  async restartProfileWithRotatedProxy(profileId, browser) {
    console.log("🔄 Proxy blocked. Rotating proxy and restarting profile...");

    try {
      if (browser) {
        await browser.close();
        console.log("✅ Browser closed before profile restart");
      }
    } catch (error) {
      console.warn(`⚠️ Failed to close browser before restart: ${error.message}`);
    }

    try {
      await this.multiloginAPI.stopProfile(profileId);
      console.log("✅ Existing profile stopped before restart");
    } catch (error) {
      if (error.message?.includes("profile already stopped")) {
        console.log("ℹ️ Profile was already stopped before restart");
      } else {
        console.warn(`⚠️ Failed to stop profile before restart: ${error.message}`);
      }
    }

    const newProxyConfig = await this.multiloginAPI.rotateProxyAsync();
    const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(newProxyConfig);
    console.log(`📤 Rotated proxy config: ${formattedProxy.host}:${formattedProxy.port}`);

    const updateResult = await this.multiloginAPI.updateProfileProxy(profileId, formattedProxy);
    if (updateResult?.status?.http_code !== 200) {
      throw new Error(`Failed to update profile proxy after rotation: ${updateResult?.status?.message || "unknown error"}`);
    }

    console.log("✅ Profile proxy updated after rotation");
    const restartedBrowser = await this.launchBrowser(profileId);
    const page = await this.navigateToPage(restartedBrowser);

    return { browser: restartedBrowser, page };
  }

  async initialize() {
    console.log("🚀 Инициализация DTC worker...");

    this.multiloginAPI = new (await import("./multilogin/multilogin.js")).MultiloginAPI(
      this.multiloginCredentials.email,
      this.multiloginCredentials.password
    );
    await this.multiloginAPI.apiInit();
    console.log("✅ Multilogin API инициализирован");

    this.captchaSolver = new (await import("./captcha/solver.js")).ImpervaBypassSolver(this.captchaApiKey);
    console.log("✅ Imperva Bypass Solver инициализирован");

    this.dtcLoginAPI = new DtcLoginAPI();
    await this.dtcLoginAPI.login();
    console.log("✅ DTC Login API инициализирован");
  }

  async start(options = {}) {
    const { once = false } = options;

    console.log(`▶️ Запуск DTC worker${once ? " (single run)" : ""}...`);
    this.isRunning = true;

    while (this.isRunning) {
      try {
        const task = await this.takeNextAvailableLogin();

        if (!task) {
          console.log("⭕ Нет доступных DTC login задач, ожидание...");
          if (once) {
            return;
          }

          await this.sleep(this.pollIntervalMs);
          continue;
        }

        await this.processDtcLogin(task);

        if (once) {
          return;
        }

        await this.sleep(3000);
      } catch (error) {
        console.error("❌ Ошибка в DTC worker loop:", error.message);

        if (once) {
          throw error;
        }

        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  async takeNextAvailableLogin() {
    console.log("📋 Получаем список DTC login записей...");
    const items = await this.dtcLoginAPI.getDtcLogins();

    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    for (const item of items) {
      try {
        console.log(`🛠️ Пытаемся взять запись ${item.id}...`);
        const taken = await this.dtcLoginAPI.takeDtcLogin(item.id);

        if (taken?.error) {
          console.log(`⚠️ Не удалось взять запись ${item.id}: ${taken.error}`);
          continue;
        }

        console.log(`✅ Запись ${item.id} взята в работу`);
        return taken;
      } catch (error) {
        console.warn(`⚠️ Ошибка при взятии записи ${item?.id}: ${error.message}`);
      }
    }

    return null;
  }

  buildLoginData(task) {
    if (!task?.licence_number || !task?.theory_test_ref) {
      throw new Error(`Task ${task?.id ?? "unknown"} does not contain licence_number/theory_test_ref`);
    }

    return {
      taskId: task.id,
      username: task.licence_number,
      password: task.theory_test_ref,
      profileName: `DTC_${task.id}`
    };
  }

  async verifyDtcLogin(page, loginData) {
    try {
      console.log("🔑 Проверка DTC логина...");

      await this.randomDelay(200, 500);
      await this.humanTyping(page, "#driving-licence-number", loginData.username);
      await this.randomDelay(300, 800);
      await this.humanTyping(page, "#application-reference-number", loginData.password);

      await this.validateFieldContent(page, "#driving-licence-number", loginData.username);
      await this.validateFieldContent(page, "#application-reference-number", loginData.password);

      await this.randomDelay(400, 900);
      await this.humanClick(page, "#booking-login");

      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
      await this.sleep(3000);

      const loginError = await this.checkForLoginError(page);
      if (loginError.hasError) {
        return {
          success: false,
          error: "invalid_credentials",
          message: loginError.message
        };
      }

      try {
        await page.locator("#interstitial-inprogress").waitFor({ state: "attached", timeout: 5000 });
        await this.waitForInterstitialToDisappear(page);
      } catch {
        // no interstitial
      }

      const hasCaptchaAfterInterstitial = await this.checkForIncapsula(page);
      if (hasCaptchaAfterInterstitial) {
        try {
          await this.attemptBypassWithRetries(page, "Post-interstitial");
          await this.sleep(3000);
        } catch (error) {
          return {
            success: false,
            error: "captcha_failed",
            message: error.message
          };
        }
      }

      const currentUrl = page.url();
      console.log(`📍 URL после DTC логина: ${currentUrl}`);

      if (!currentUrl.includes("/manage")) {
        return {
          success: false,
          error: "unknown_login_issue",
          message: "Login did not reach /manage"
        };
      }

      const hasCaptchaAfterLogin = await this.checkForIncapsula(page);
      if (hasCaptchaAfterLogin) {
        try {
          await this.attemptBypassWithRetries(page, "Post-login");
          await this.sleep(3000);
        } catch (error) {
          return {
            success: false,
            error: "captcha_failed",
            message: error.message
          };
        }
      }

      const isViewBookingPage = await this.checkViewBookingPage(page);
      if (!isViewBookingPage) {
        return {
          success: false,
          error: "page_validation_failed",
          message: "Login succeeded but View booking page was not confirmed"
        };
      }

      return {
        success: true,
        message: "DTC login verified successfully"
      };
    } catch (error) {
      console.error("❌ Ошибка проверки DTC логина:", error.message);
      throw error;
    }
  }

  async processDtcLogin(task) {
    let browser = null;
    let profileId = null;
    const loginData = this.buildLoginData(task);

    try {
      console.log(`🔄 Обработка DTC login ${task.id}...`);

      profileId = await this.createProfile(loginData.profileName);
      browser = await this.launchBrowser(profileId);
      let page = await this.navigateToPage(browser);

      try {
        const hasCaptcha = await this.checkForIncapsula(page);
        if (hasCaptcha) {
          console.log("🛡️ Обнаружена Incapsula, обходим...");
          await this.attemptBypassWithRetries(page, "Initial page");
        }
      } catch (error) {
        if (!(error instanceof ProxyBlockedError)) {
          throw error;
        }

        const restarted = await this.restartProfileWithRotatedProxy(profileId, browser);
        browser = restarted.browser;
        page = restarted.page;

        const hasCaptchaAfterRestart = await this.checkForIncapsula(page);
        if (hasCaptchaAfterRestart) {
          console.log("🛡️ Повторный bypass после ротации прокси...");
          await this.attemptBypassWithRetries(page, "Initial page after proxy rotation");
        }
      }

      const hasLoginForm = await this.checkLoginForm(page);
      if (!hasLoginForm) {
        throw new Error("Login form not found");
      }

      const loginResult = await this.verifyDtcLogin(page, loginData);

      if (loginResult.success) {
        await this.dtcLoginAPI.approveDtcLogin(task.id, {
          licence_number: loginData.username,
          theory_test_ref: loginData.password
        });
        console.log(`✅ DTC login ${task.id} approved`);
        return;
      }

      await this.dtcLoginAPI.failDtcLogin(task.id, {
        licence_number: loginData.username,
        theory_test_ref: loginData.password,
        error: loginResult.message || loginResult.error || "DTC login verification failed"
      });
      console.log(`❌ DTC login ${task.id} marked as failed`);
    } catch (error) {
      console.error(`❌ Ошибка обработки DTC login ${task.id}: ${error.message}`);

      try {
        await this.dtcLoginAPI.failDtcLogin(task.id, {
          licence_number: loginData.username,
          theory_test_ref: loginData.password,
          error: error.message
        });
        console.log(`❌ DTC login ${task.id} marked as failed after exception`);
      } catch (failError) {
        console.error(`❌ Не удалось отправить fail для ${task.id}: ${failError.message}`);
      }
    } finally {
      await this.cleanup(browser, profileId);
    }
  }
}

function printUsage() {
  console.log(`Usage:
  node dtc_worker.js
  node dtc_worker.js --once`);
}

async function main() {
  const once = process.argv.includes("--once");

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const worker = new DtcLoginWorker();

  await worker.initialize();
  await worker.start({ once });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    printUsage();
    process.exit(1);
  });
}
