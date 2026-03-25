import dotenv from 'dotenv';
dotenv.config()
import { chromium } from "playwright";
import { CaptchaSolver } from "./captcha/solver.js";
import { MultiloginAPI } from "./multilogin/multilogin.js";
import { TasksAPI } from "./api/TasksAPI.js";
import fs from 'fs';

// Загружаем данные тест-центров
const testCentresData = JSON.parse(fs.readFileSync('./test_centres_data_formatted.json', 'utf8'));

// ===============================
// ПРОСТАЯ КОНФИГУРАЦИЯ
// ===============================
const CONFIG = {
  TARGET_URL: 'https://driverpracticaltest.dvsa.gov.uk/login',
  TIMEOUTS: {
    PAGE_LOAD: 30000,
    WEBSOCKET_CONNECT: 10000
  }
};

// ===============================
// УПРОЩЕННЫЙ КЛАСС БОТА
// ===============================
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
  }

  // ===============================
  // ИНИЦИАЛИЗАЦИЯ
  // ===============================
  async initialize() {
    console.log("🚀 Инициализация бота...");

    // Multilogin API
    this.multiloginAPI = new MultiloginAPI(
      this.multiloginCredentials.email,
      this.multiloginCredentials.password
    );
    await this.multiloginAPI.apiInit();
    console.log("✅ Multilogin API инициализирован");

    // Captcha Solver
    this.captchaSolver = new CaptchaSolver(this.captchaApiKey);
    console.log("✅ Captcha Solver инициализирован");

    // Tasks API
    this.tasksAPI = new TasksAPI(this.tasksApiToken, this.workerName);
    console.log("✅ Tasks API инициализирован");
  }

  // ===============================
  // ГЛАВНЫЙ ЦИКЛ
  // ===============================
  async start() {
    console.log("▶️ Запуск главного цикла...");
    this.isRunning = true;

    while (this.isRunning) {
      try {
        // 1. Получить задачу
        const task = await this.tasksAPI.getTask();

        if (!task) {
          console.log("⭕ Нет доступных задач, ожидание...");
          await this.sleep(5000);
          continue;
        }

        console.log(`📋 Получена задача: ${task.id}`);

        // 2. Обработать задачу
        await this.processTask(task);

        // 3. Пауза между задачами
        await this.sleep(3000);

      } catch (error) {
        console.error("❌ Ошибка в главном цикле:", error.message);
        await this.sleep(5000);
      }
    }
  }

  // ===============================
  // ОБРАБОТКА ОДНОЙ ЗАДАЧИ
  // ===============================
  async processTask(task) {
    let browser = null;
    let profileId = null;

    try {
      console.log(`🔄 Обработка задачи ${task.id}...`);

      // Конвертируем задачу в данные для логина
      const loginData = this.tasksAPI.convertTaskToLoginData(task);

      // 1. Создать/найти профиль
      profileId = await this.createProfile(loginData.profileName);

      // 2. Запустить браузер
      browser = await this.launchBrowser(profileId);

      // 3. Навигация на целевую страницу
      const page = await this.navigateToPage(browser);

      // 4. Проверить капчу
      const hasCaptcha = await this.checkForCaptcha(page);
      if (hasCaptcha) {
        console.log("🧩 Обнаружена капча, решаем...");
        await this.solveCaptcha(page);
      }

      // 5. Проверить форму логина
      const hasLoginForm = await this.checkLoginForm(page);
      if (hasLoginForm) {
        console.log("✅ Форма логина найдена!");

        // Выполнить логин
        const loginResult = await this.performLogin(page, loginData);

        // Проверить результат логина
        if (loginResult.success === false && loginResult.error === 'invalid_credentials') {
          console.log("🚫 Обнаружены некорректные креденциалы, обрабатываем...");

          // Обработать некорректные креденциалы
          const handleResult = await this.handleInvalidCredentials(task, loginResult.message);

          if (handleResult.success) {
            console.log(`✅ Задача ${task.id} отменена, переходим к следующей`);
            return; // Выходим из обработки этой задачи
          } else {
            console.log(`⚠️ Не удалось отменить задачу: ${handleResult.error}`);
          }
        } else if (loginResult.success) {
          console.log("🎉 Логин успешен, продолжаем workflow");
        }

        // Логика обработки результата логина теперь внутри performLogin()
        if (loginResult.success) {
          console.log("🎉 Полный workflow логина завершен успешно");
        } else {
          console.log(`⚠️ Workflow логина завершился с ошибкой: ${loginResult.error}`);
        }

      } else {
        console.log("⚠️ Форма логина не найдена");
      }

      // Дополнительная пауза для анализа результатов
      await this.sleep('50000');
      console.log(`✅ Задача ${task.id} обработана`);

    } catch (error) {
      console.error(`❌ Ошибка обработки задачи ${task.id}:`, error.message);
    } finally {
      await this.cleanup(browser, profileId);
    }
  }

  // ===============================
  // СОЗДАНИЕ/ПОИСК ПРОФИЛЯ
  // ===============================
  async createProfile(profileName) {
    console.log(`🔍 Создание/поиск профиля: ${profileName}`);

    try {
      // Поиск существующего профиля
      const searchResult = await this.multiloginAPI.searchProfile(profileName);

      if (searchResult.data && searchResult.data.profiles === null) {
        // Профиль не найден - создаем новый
        console.log("📝 Создание нового профиля...");
        const currentProxy = this.multiloginAPI.getCurrentProxy();
        const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(currentProxy);

        const createResult = await this.multiloginAPI.createProfile(
          profileName,
          formattedProxy,
          'mimic'
        );

        if (createResult.status.http_code === 201) {
          const profileId = createResult.data.ids[0];
          console.log(`✅ Профиль создан с ID: ${profileId}`);
          return profileId;
        } else {
          throw new Error(`Ошибка создания профиля: ${createResult.status.message}`);
        }
      } else {
        // Профиль найден
        const profile = searchResult.data.profiles.find(p => p.name === profileName);
        const profileId = profile.id;
        console.log(`✅ Профиль найден с ID: ${profileId}`);
        return profileId;
      }

    } catch (error) {
      throw new Error(`Ошибка работы с профилем: ${error.message}`);
    }
  }

  // ===============================
  // ЗАПУСК БРАУЗЕРА
  // ===============================
  async launchBrowser(profileId) {
    console.log(`🌐 Запуск браузера для профиля ${profileId}...`);

    try {
      // Запуск профиля Multilogin
      let startResult = await this.multiloginAPI.startProfile(profileId);

      // Обработка ошибки прокси
      if (startResult.status.http_code !== 200 && startResult.status.error_code === 'GET_PROXY_CONNECTION_IP_ERROR') {
        console.log("⚠️ Ошибка подключения к прокси, получаем новый...");

        // Получаем новый прокси через систему ротации
        const newProxyConfig = this.multiloginAPI.rotateProxy();
        const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(newProxyConfig);

        console.log("🔄 Обновляем профиль с новым прокси...");
        const updateResult = await this.multiloginAPI.updateProfileProxy(profileId, formattedProxy);
        console.log("✅ Результат обновления прокси:", updateResult);

        if (updateResult.status.http_code !== 200) {
          throw new Error(`Ошибка обновления прокси: ${updateResult.status.message}`);
        }
      }

      // Получение WebSocket endpoint
      const wsEndpoint = await this.getWebSocketEndpoint(startResult.data.port);
      console.log(`✅ WebSocket endpoint: ${wsEndpoint}`);

      // Подключение к браузеру
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
    const maxRetries = 5;
    const retryDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();
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

  // ===============================
  // НАВИГАЦИЯ НА СТРАНИЦУ
  // ===============================
  async navigateToPage(browser) {
    console.log("📄 Навигация на целевую страницу...");

    try {
      const contexts = browser.contexts();
      const pages = contexts[0].pages();
      const page = pages[0];

      await page.goto(CONFIG.TARGET_URL, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.TIMEOUTS.PAGE_LOAD
      });

      await this.sleep(2000);

      return page;

    } catch (error) {
      throw new Error(`Ошибка навигации: ${error.message}`);
    }
  }

  // ===============================
  // ПРОВЕРКА КАПЧИ
  // ===============================
  async checkForCaptcha(page) {
    try {
      await page.waitForSelector('#main-iframe', { timeout: 5000 });
      console.log("🧩 Iframe с капчей найден");
      return true;
    } catch (error) {
      console.log("ℹ️ Iframe с капчей не найден");
      return false;
    }
  }

  async solveCaptcha(page) {
    try {
      // Ждем полной загрузки iframe перед извлечением данных
      console.log("🔄 Ожидание загрузки iframe с капчей...");
      await page.waitForFunction(() => {
        const iframe = document.getElementById("main-iframe");
        return iframe && 
               iframe.contentWindow && 
               iframe.contentWindow.document && 
               iframe.contentWindow.document.readyState === 'complete' &&
               iframe.contentWindow.location.href !== 'about:blank';
      }, { timeout: 15000 });
      
      // Дополнительная пауза для загрузки капчи
      await this.sleep(3000);
      
      const captchaData = await page.evaluate(() => {
        const targetIframe = document.getElementById("main-iframe");
        // Если iframe не найден или его contentWindow недоступен
        if (!targetIframe || !targetIframe.contentWindow) {
          return { "sitekey": null, "siteurl": null, "ua": null, "status": "no-iframe" };
        }
        const iframeDocument = targetIframe.contentWindow.document;

        const isBlocked = iframeDocument.getElementsByClassName("error-code").length > 0;
        if (isBlocked) {
          return { "sitekey": false, "siteurl": false, "ua": window.navigator.userAgent, "status": "blocked" };
        }

        const siteurl = iframeDocument.location.href;
        
        // Проверяем различные селекторы для hCaptcha
        let hcaptchaElements = iframeDocument.getElementsByClassName("h-captcha");
        if (hcaptchaElements.length === 0) {
          // Пробуем альтернативные селекторы
          hcaptchaElements = iframeDocument.querySelectorAll('[data-sitekey]');
        }
        if (hcaptchaElements.length === 0) {
          hcaptchaElements = iframeDocument.querySelectorAll('.h-captcha, [class*="captcha"], [id*="captcha"]');
        }
        
        if (hcaptchaElements.length === 0) {
          console.log('Iframe content:', iframeDocument.documentElement.outerHTML.substring(0, 500));
          return { "sitekey": null, "siteurl": siteurl, "ua": window.navigator.userAgent, "status": "no-captcha" };
        }
        
        console.log('hcaptchaElements found:', hcaptchaElements.length);
        console.log('First element:', hcaptchaElements[0]);
        
        // Извлекаем sitekey из первого найденного элемента
        let sitekey = hcaptchaElements[0].getAttribute("data-sitekey");
        
        // Если sitekey не найден в data-sitekey, ищем в других атрибутах
        if (!sitekey) {
          sitekey = hcaptchaElements[0].getAttribute("site-key") || 
                   hcaptchaElements[0].getAttribute("sitekey") ||
                   hcaptchaElements[0].dataset.sitekey;
        }
        
        console.log('Extracted sitekey:', sitekey);
        return { "sitekey": sitekey, "siteurl": siteurl, "ua": window.navigator.userAgent, "status": "ready" };
      });
      console.log('captchaData', captchaData);
      if (!captchaData) {
        throw new Error("Не удалось получить данные капчи");
      }

      // Проверяем, что sitekey действительно получен
      if (!captchaData.sitekey || captchaData.sitekey === 'null') {
        throw new Error(`Sitekey не найден или пустой. Status: ${captchaData.status}, URL: ${captchaData.siteurl}`);
      }

      console.log("🔑 Решение hCaptcha...");
      const token = await this.captchaSolver.solveHcaptcha(
        captchaData.siteurl,
        captchaData.sitekey,
        captchaData.ua
      );

      // Отправляем токен в iframe
      await page.evaluate(({ token }) => {
        const iframe = document.getElementById("main-iframe");
        if (iframe && iframe.contentWindow) {
          const iframeWindow = iframe.contentWindow;
          if (typeof iframeWindow.onCaptchaFinished === 'function') {
            iframeWindow.onCaptchaFinished(token);
          }
        }
      }, { token });

      console.log("✅ Капча решена и токен отправлен");

    } catch (error) {
      console.error("❌ Ошибка решения капчи:", error.message);
      throw error;
    }
  }

  // ===============================
  // ПРОВЕРКА ФОРМЫ ЛОГИНА
  // ===============================
  async checkLoginForm(page) {
    try {
      console.log("🔄 Ожидание полной загрузки всех скриптов...");
      
      // Ждем загрузки всех скриптов и готовности DOM
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      
      // Ждем выполнения jQuery и других скриптов
      await page.waitForFunction(() => {
        return typeof window.jQuery !== 'undefined' && 
               document.readyState === 'complete' &&
               !document.querySelector('.loading') && // нет элементов загрузки
               window.jQuery && 
               window.jQuery.isReady; // jQuery готов
      }, { timeout: 10000 });
      
      // Дополнительная пауза для полной инициализации
      await this.sleep(3000);
      
      console.log("✅ Скрипты загружены, проверяем форму...");
      
      // Ждем появления элементов формы с увеличенным таймаутом
      await page.waitForSelector('#driving-licence-number', { timeout: 10000, state: 'visible' });
      await page.waitForSelector('#application-reference-number', { timeout: 10000, state: 'visible' });
      await page.waitForSelector('#booking-login', { timeout: 10000, state: 'visible' });
      
      // Проверяем наличие основных элементов формы логина
      const licenseField = await page.locator('#driving-licence-number').isVisible({ timeout: 3000 });
      const referenceField = await page.locator('#application-reference-number').isVisible({ timeout: 3000 });
      const loginButton = await page.locator('#booking-login').isVisible({ timeout: 3000 });

      // Дополнительная проверка - элементы должны быть enabled
      const licenseEnabled = licenseField ? await page.locator('#driving-licence-number').isEnabled() : false;
      const referenceEnabled = referenceField ? await page.locator('#application-reference-number').isEnabled() : false;
      const loginEnabled = loginButton ? await page.locator('#booking-login').isEnabled() : false;

      console.log(`📝 Элементы формы: лицензия=${licenseField}(${licenseEnabled}), референс=${referenceField}(${referenceEnabled}), кнопка=${loginButton}(${loginEnabled})`);

      return licenseField && referenceField && loginButton && licenseEnabled && referenceEnabled && loginEnabled;

    } catch (error) {
      console.warn("⚠️ Ошибка проверки формы логина:", error.message);
      
      // Отладочная информация при ошибке
      try {
        const currentUrl = page.url();
        console.log(`🔍 Текущий URL: ${currentUrl}`);
        
        const pageTitle = await page.title();
        console.log(`📄 Заголовок страницы: ${pageTitle}`);
        
        // Проверяем, есть ли элементы в DOM (даже если невидимы)
        const licenseExists = await page.locator('#driving-licence-number').count();
        const referenceExists = await page.locator('#application-reference-number').count();
        const loginExists = await page.locator('#booking-login').count();
        
        console.log(`🔍 Элементы в DOM: лицензия=${licenseExists}, референс=${referenceExists}, кнопка=${loginExists}`);
        
      } catch (debugError) {
        console.warn("⚠️ Ошибка получения отладочной информации:", debugError.message);
      }
      
      return false;
    }
  }

  // ===============================
  // ВЫПОЛНЕНИЕ ЛОГИНА С STEALTH ТЕХНОЛОГИЯМИ
  // ===============================
  async performLogin(page, loginData) {
    try {
      console.log("🔑 Выполнение логина с использованием stealth технологий...");

      // Случайная задержка перед началом для имитации человеческого поведения
      await this.randomDelay(200, 500);

      // Заполнение поля номера водительских прав с человекоподобным поведением
      console.log("📝 Заполнение поля driving-licence-number...");
      await this.humanTyping(page, '#driving-licence-number', loginData.username);

      // Случайная задержка между полями
      await this.randomDelay(300, 800);

      console.log("📝 Заполнение поля application-reference-number...");
      await this.humanTyping(page, '#application-reference-number', loginData.password);

      // Проверка успешности заполнения полей
      await this.validateFieldContent(page, '#driving-licence-number', loginData.username);
      await this.validateFieldContent(page, '#application-reference-number', loginData.password);

      // Случайная задержка перед кликом
      await this.randomDelay(400, 900);

      // Человекоподобный клик по кнопке входа
      await this.humanClick(page, '#booking-login');
      console.log("✅ Форма логина отправлена с использованием stealth техник");

      // Ожидание результата
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await this.sleep(3000);

      // ПЕРВАЯ ПРОВЕРКА: Ошибка логина (приоритет)
      console.log("🔍 Проверка ошибок логина...");
      const loginError = await this.checkForLoginError(page);

      if (loginError.hasError) {
        console.log("❌ Обнаружена ошибка логина, прерываем выполнение");
        return {
          success: false,
          error: 'invalid_credentials',
          message: loginError.message
        };
      }

      // Проверка промежуточной страницы
      console.log("🔍 Проверяем наличие промежуточной страницы...");
      try {
        // Ждем появления элемента в DOM с таймаутом 5 секунд
        await page.locator('#interstitial-inprogress').waitFor({ state: 'attached', timeout: 5000 });
        console.log("⏳ Обнаружена промежуточная страница, ожидаем...");
        await this.waitForInterstitialToDisappear(page);
      } catch (error) {
        // Элемент не появился за 5 секунд - продолжаем
        console.log("ℹ️ Промежуточная страница не появилась, продолжаем...");
      }

      // ВАЖНО: Проверяем капчу после промежуточной страницы (может появиться между логином и переходом на /manage)
      console.log("🔍 Проверяем наличие капчи после промежуточной страницы...");
      const hasCaptchaAfterInterstitial = await this.checkForCaptcha(page);
      if (hasCaptchaAfterInterstitial) {
        console.log("🧩 Обнаружена капча после промежуточной страницы, решаем...");
        try {
          await this.solveCaptcha(page);
          console.log("✅ Капча после промежуточной страницы решена успешно");
          
          // Дополнительная пауза после решения капчи
          await this.sleep(3000);
        } catch (captchaError) {
          console.error("❌ Ошибка решения капчи после промежуточной страницы:", captchaError.message);
          return { success: false, error: 'captcha_failed', message: "Failed to solve captcha after interstitial" };
        }
      } else {
        console.log("ℹ️ Капчи после промежуточной страницы не обнаружено");
      }

      const currentUrl = page.url();
      console.log(`📍 URL после логина: ${currentUrl}`);

      // Расширенная проверка успешности логина и навигация
      if (currentUrl.includes('/manage')) {
        console.log("✅ Логин успешен! Проверяем наличие капчи после логина...");

        // ВАЖНО: Сначала проверяем капчу после логина
        const hasCaptchaAfterLogin = await this.checkForCaptcha(page);
        if (hasCaptchaAfterLogin) {
          console.log("🧩 Обнаружена капча после логина, решаем...");
          try {
            await this.solveCaptcha(page);
            console.log("✅ Капча после логина решена успешно");
            
            // Дополнительная пауза после решения капчи
            await this.sleep(3000);
          } catch (captchaError) {
            console.error("❌ Ошибка решения капчи после логина:", captchaError.message);
            return { success: false, error: 'captcha_failed', message: "Failed to solve captcha after login" };
          }
        } else {
          console.log("ℹ️ Капчи после логина не обнаружено");
        }

        console.log("🔍 Проверяем страницу View booking...");
        
        // Проверка страницы View booking (только после решения капчи)
        const isViewBookingPage = await this.checkViewBookingPage(page);

        if (isViewBookingPage) {
          console.log("🎯 Переходим к Test centre...");

          // Stealth навигация к Test centre
          const navigationSuccess = await this.navigateToTestCentre(page);

          if (navigationSuccess) {
            // Проверка страницы Test centre
            const isTestCentrePage = await this.checkTestCentrePage(page);

            if (isTestCentrePage) {
              console.log("🎉 Успешно попали на страницу Test centre, начинаем поиск...");
              
              // Выполняем поиск тест-центра
              const searchSuccess = await this.searchTestCentre(page, loginData);
              
              if (searchSuccess) {
                console.log("🎉 Полный workflow завершен успешно: Login → View Booking → Test Centre → Search");
                return { success: true, message: "Successfully completed test centre search" };
              } else {
                console.log("⚠️ Не удалось выполнить поиск тест-центра");
                return { success: false, error: 'search_failed', message: "Failed to search test centre" };
              }
            } else {
              console.log("⚠️ Не удалось подтвердить переход на страницу Test centre");
              return { success: false, error: 'navigation_failed', message: "Failed to reach Test Centre page" };
            }
          } else {
            console.log("❌ Не удалось перейти к странице Test centre");
            return { success: false, error: 'navigation_failed', message: "Failed to navigate to Test Centre" };
          }
        } else {
          console.log("⚠️ Не удалось подтвердить страницу View booking");
          return { success: false, error: 'page_validation_failed', message: "Failed to validate View Booking page" };
        }
      } else {
        console.log("⚠️ Возможная ошибка логина или требуется дополнительная проверка");
        return { success: false, error: 'unknown_login_issue', message: "Login result unclear" };
      }

    } catch (error) {
      console.error("❌ Ошибка выполнения stealth логина:", error.message);
      throw error;
    }
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНАЯ ПЕЧАТЬ С ОПЕЧАТКАМИ
  // ===============================
  async humanTyping(page, selector, text) {
    try {
      console.log(`⌨️ Человекоподобная печать с опечатками для селектора: ${selector}`);

      // Фокус на элемент
      await this.moveMouseToElement(page, selector);
      await page.click(selector);
      await this.randomDelay(100, 200);

      // Очистка поля
      await page.fill(selector, '');
      await this.randomDelay(50, 100);

      // Печать символ за символом с имитацией человеческих ошибок
      for (let i = 0; i < text.length; i++) {
        const currentChar = text[i];

        // Случайная вероятность сделать опечатку (5% шанс)
        if (Math.random() < 0.05 && i > 0 && i < text.length - 1) {
          await this.makeTypingMistake(page, selector, text, i);
          continue; // Пропускаем нормальную печать этого символа
        }

        // Обычная печать символа
        await page.keyboard.type(currentChar);

        // Случайные задержки между символами (имитация скорости печати человека)
        const delay = Math.random() * 150 + 50; // 50-200ms
        await this.sleep(delay);

        // Иногда делаем более длинную паузу (имитация размышления)
        if (Math.random() < 0.1) { // 10% шанс
          await this.sleep(Math.random() * 500 + 200); // 200-700ms
        }
      }

      console.log("✅ Человекоподобная печать с опечатками завершена");

    } catch (error) {
      console.warn(`⚠️ Ошибка человекоподобной печати для ${selector}:`, error.message);
      throw error;
    }
  }

  // ===============================
  // ДВИЖЕНИЕ МЫШИ К ЭЛЕМЕНТУ
  // ===============================
  async moveMouseToElement(page, selector) {
    try {
      // Получаем координаты элемента
      const element = await page.locator(selector);
      const box = await element.boundingBox();

      if (box) {
        // Случайная точка внутри элемента (не в центре)
        const x = box.x + Math.random() * box.width;
        const y = box.y + Math.random() * box.height;

        // Плавное движение мыши
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
        await this.randomDelay(50, 150);
      }
    } catch (error) {
      console.warn(`⚠️ Ошибка движения мыши к элементу ${selector}:`, error.message);
    }
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНЫЙ КЛИК
  // ===============================
  async humanClick(page, selector) {
    try {
      console.log(`🖱️ Человекоподобный клик по селектору: ${selector}`);

      // Движение мыши к элементу
      await this.moveMouseToElement(page, selector);

      // Случайная задержка перед кликом
      await this.randomDelay(100, 300);

      // Клик с небольшой случайной задержкой нажатия
      await page.mouse.down();
      await this.sleep(Math.random() * 100 + 50); // 50-150ms
      await page.mouse.up();

      console.log("✅ Человекоподобный клик выполнен");

    } catch (error) {
      console.warn(`⚠️ Ошибка человекоподобного клика по ${selector}:`, error.message);
      throw error;
    }
  }

  // ===============================
  // ВАЛИДАЦИЯ СОДЕРЖИМОГО ПОЛЯ
  // ===============================
  async validateFieldContent(page, selector, expectedValue) {
    try {
      const actualValue = await page.inputValue(selector);
      const isValid = actualValue === expectedValue;

      console.log(`${isValid ? '✅' : '❌'} Валидация поля ${selector}: ожидалось "${expectedValue}", получено "${actualValue}"`);

      if (!isValid) {
        console.warn(`⚠️ Поле ${selector} содержит неправильное значение. Попытка исправления...`);
        await page.fill(selector, expectedValue);
        await this.randomDelay(200, 400);

        // Повторная проверка
        const correctedValue = await page.inputValue(selector);
        console.log(`🔄 После исправления значение поля ${selector}: "${correctedValue}"`);
      }

      return isValid;

    } catch (error) {
      console.warn(`⚠️ Ошибка валидации поля ${selector}:`, error.message);
      return false;
    }
  }

  // ===============================
  // ИМИТАЦИЯ ОПЕЧАТКИ И ИСПРАВЛЕНИЯ
  // ===============================
  async makeTypingMistake(page, selector, text, currentIndex) {
    try {
      const currentChar = text[currentIndex];
      const mistakeType = Math.random();

      console.log(`🔤 Делаем опечатку на позиции ${currentIndex} (символ: "${currentChar}")`);

      if (mistakeType < 0.4) {
        // Тип 1: Перестановка символов местами (самый частый тип ошибки)
        await this.swapCharactersMistake(page, text, currentIndex);

      } else if (mistakeType < 0.7) {
        // Тип 2: Неправильный символ
        await this.wrongCharacterMistake(page, currentChar);

      } else {
        // Тип 3: Двойное нажатие символа
        await this.doubleCharacterMistake(page, currentChar);
      }

    } catch (error) {
      console.warn(`⚠️ Ошибка при создании опечатки:`, error.message);
      // Fallback: просто печатаем правильный символ
      await page.keyboard.type(text[currentIndex]);
    }
  }

  // ===============================
  // ПЕРЕСТАНОВКА СИМВОЛОВ МЕСТАМИ
  // ===============================
  async swapCharactersMistake(page, text, currentIndex) {
    const currentChar = text[currentIndex];
    const nextChar = text[currentIndex + 1];

    if (!nextChar) return;

    console.log(`🔄 Перестановка символов: "${currentChar}${nextChar}" → "${nextChar}${currentChar}"`);

    // Печатаем символы в неправильном порядке
    await page.keyboard.type(nextChar);
    await this.randomDelay(50, 150);
    await page.keyboard.type(currentChar);

    // Пауза "осознания" ошибки
    await this.randomDelay(300, 800);
    console.log("🤔 Замечаем опечатку...");

    // Удаляем два неправильных символа
    await page.keyboard.press('Backspace');
    await this.randomDelay(100, 200);
    await page.keyboard.press('Backspace');
    await this.randomDelay(100, 300);

    // Печатаем правильно
    console.log("✍️ Исправляем опечатку...");
    await page.keyboard.type(currentChar);
    await this.randomDelay(80, 180);
    await page.keyboard.type(nextChar);

    console.log("✅ Опечатка исправлена");
  }

  // ===============================
  // НЕПРАВИЛЬНЫЙ СИМВОЛ
  // ===============================
  async wrongCharacterMistake(page, correctChar) {
    // Карта похожих символов для реалистичных ошибок
    const similarChars = {
      'a': ['s', 'q', 'w'], 's': ['a', 'd', 'w'], 'd': ['s', 'f', 'e'], 'f': ['d', 'g', 'r'],
      'g': ['f', 'h', 't'], 'h': ['g', 'j', 'y'], 'j': ['h', 'k', 'u'], 'k': ['j', 'l', 'i'],
      'l': ['k', 'o', 'p'], 'q': ['w', 'a'], 'w': ['q', 'e', 's'], 'e': ['w', 'r', 'd'],
      'r': ['e', 't', 'f'], 't': ['r', 'y', 'g'], 'y': ['t', 'u', 'h'], 'u': ['y', 'i', 'j'],
      'i': ['u', 'o', 'k'], 'o': ['i', 'p', 'l'], 'p': ['o', 'l'], 'z': ['x', 'a'], 'x': ['z', 'c'],
      'c': ['x', 'v'], 'v': ['c', 'b'], 'b': ['v', 'n'], 'n': ['b', 'm'], 'm': ['n'],
      '0': ['9', '1'], '1': ['0', '2'], '2': ['1', '3'], '3': ['2', '4'], '4': ['3', '5'],
      '5': ['4', '6'], '6': ['5', '7'], '7': ['6', '8'], '8': ['7', '9'], '9': ['8', '0']
    };

    const lowerChar = correctChar.toLowerCase();
    const possibleMistakes = similarChars[lowerChar] || ['x', 'z'];
    const wrongChar = possibleMistakes[Math.floor(Math.random() * possibleMistakes.length)];

    console.log(`❌ Неправильный символ: "${correctChar}" → "${wrongChar}"`);

    // Печатаем неправильный символ
    await page.keyboard.type(wrongChar);

    // Пауза осознания ошибки
    await this.randomDelay(400, 900);
    console.log("🤔 Замечаем неправильный символ...");

    // Удаляем неправильный символ
    await page.keyboard.press('Backspace');
    await this.randomDelay(150, 300);

    // Печатаем правильный символ
    console.log("✍️ Исправляем символ...");
    await page.keyboard.type(correctChar);

    console.log("✅ Символ исправлен");
  }

  // ===============================
  // ДВОЙНОЕ НАЖАТИЕ СИМВОЛА
  // ===============================
  async doubleCharacterMistake(page, correctChar) {
    console.log(`⌨️ Двойное нажатие символа: "${correctChar}"`);

    // Печатаем символ дважды
    await page.keyboard.type(correctChar);
    await this.randomDelay(30, 80);
    await page.keyboard.type(correctChar);

    // Пауза осознания ошибки
    await this.randomDelay(350, 700);
    console.log("🤔 Замечаем двойной символ...");

    // Удаляем лишний символ
    await page.keyboard.press('Backspace');
    await this.randomDelay(100, 250);

    console.log("✅ Лишний символ удален");
  }

  // ===============================
  // СЛУЧАЙНАЯ ЗАДЕРЖКА
  // ===============================
  async randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    console.log(`⏱️ Случайная задержка: ${delay}ms`);
    await this.sleep(delay);
  }

  // ===============================
  // ОЖИДАНИЕ ИСЧЕЗНОВЕНИЯ ПРОМЕЖУТОЧНОЙ СТРАНИЦЫ
  // ===============================
  async waitForInterstitialToDisappear(page) {
    const maxAttempts = 3;
    const waitTime = 10000; // 10 секунд

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔄 Попытка ${attempt}/${maxAttempts}: ожидание исчезновения промежуточной страницы...`);

      try {
        // Ждем исчезновения элемента
        await page.waitForSelector('#interstitial-inprogress', {
          state: 'hidden',
          timeout: waitTime
        });

        console.log("✅ Промежуточная страница исчезла!");
        return;

      } catch (error) {
        console.log(`⚠️ Промежуточная страница все еще видна (попытка ${attempt}/${maxAttempts})`);

        if (attempt < maxAttempts) {
          console.log("🔄 Перезагружаем страницу...");
          await page.reload({ waitUntil: 'domcontentloaded' });
          await this.sleep(3000);
        }
      }
    }

    console.log("❌ Промежуточная страница не исчезла после 3 попыток, продолжаем...");
  }

  // ===============================
  // ПРОВЕРКА СТРАНИЦЫ VIEW BOOKING
  // ===============================
  async checkViewBookingPage(page) {
    try {
      console.log("🔍 Проверка страницы View booking...");

      // Проверяем заголовок страницы
      const viewBookingHeader = await page.locator('h1:has-text("View booking")').isVisible({ timeout: 5000 });

      // Проверяем body id
      const bodyId = await page.evaluate(() => document.body.id);
      const correctBodyId = bodyId === 'page-ibs-summary';

      // Проверяем наличие кнопки Test centre change
      const testCentreButton = await page.locator('#test-centre-change').isVisible({ timeout: 3000 });

      console.log(`📊 View booking проверки: заголовок=${viewBookingHeader}, body id=${correctBodyId}, кнопка=${testCentreButton}`);

      const isViewBookingPage = viewBookingHeader && correctBodyId && testCentreButton;

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

  // ===============================
  // STEALTH НАВИГАЦИЯ К TEST CENTRE
  // ===============================
  async navigateToTestCentre(page) {
    try {
      console.log("🎯 Начинаем stealth навигацию к странице Test centre...");

      // 1. Проверяем, что мы находимся на правильной странице
      const isViewBookingPage = await this.checkViewBookingPage(page);
      if (!isViewBookingPage) {
        console.log("❌ Не находимся на странице View booking");
        return false;
      }

      // 2. Имитируем чтение страницы пользователем
      await this.simulatePageReading(page);

      // 3. Поиск кнопки test-centre-change с fallback стратегиями
      const buttonFound = await this.findTestCentreButton(page);
      if (!buttonFound) {
        console.log("❌ Кнопка #test-centre-change не найдена даже с fallback стратегиями");
        return false;
      }

      // 4. Человекоподобное движение к кнопке
      await this.humanNavigateToButton(page, '#test-centre-change');

      // 5. Stealth клик по кнопке
      const clickSuccess = await this.stealthClickButton(page, '#test-centre-change');
      if (!clickSuccess) {
        console.log("❌ Не удалось выполнить stealth клик по кнопке");
        return false;
      }

      // 6. Ожидание навигации и загрузки новой страницы
      const navigationSuccess = await this.waitForTestCentrePageLoad(page);
      if (!navigationSuccess) {
        console.log("❌ Навигация к странице Test centre не удалась");
        return false;
      }

      // 7. Проверка капчи на новой странице
      const hasCaptcha = await this.checkForCaptcha(page);
      if (hasCaptcha) {
        console.log("🧩 Обнаружена капча на странице Test centre, решаем...");
        try {
          await this.solveCaptcha(page);
          console.log("✅ Капча на странице Test centre решена");
        } catch (error) {
          console.error("❌ Ошибка решения капчи на странице Test centre:", error.message);
          return false;
        }
      }

      // 8. Финальная проверка успешности навигации
      const finalCheck = await this.checkTestCentrePage(page);
      if (finalCheck) {
        console.log("🎉 Stealth навигация к Test centre успешно завершена!");

        // Случайная задержка после успешной навигации
        await this.randomDelay(800, 1500);
        return true;
      } else {
        console.log("❌ Финальная проверка страницы Test centre не пройдена");
        return false;
      }

    } catch (error) {
      console.error("❌ Критическая ошибка в stealth навигации:", error.message);
      return false;
    }
  }

  // ===============================
  // ИМИТАЦИЯ ЧТЕНИЯ СТРАНИЦЫ ПОЛЬЗОВАТЕЛЕМ
  // ===============================
  async simulatePageReading(page) {
    try {
      console.log("📖 Имитируем чтение страницы пользователем...");

      // Случайные движения мыши по странице (имитация чтения)
      const readingMovements = Math.floor(Math.random() * 3) + 2; // 2-4 движения

      for (let i = 0; i < readingMovements; i++) {
        // Случайные координаты в пределах viewport
        const x = Math.random() * 800 + 100; // 100-900px
        const y = Math.random() * 400 + 150; // 150-550px

        await page.mouse.move(x, y, {
          steps: Math.floor(Math.random() * 8) + 5 // 5-12 шагов движения
        });

        // Пауза "чтения" в текущей позиции
        await this.randomDelay(800, 2000);
      }

      // Имитируем скроллинг для поиска информации
      const scrollCount = Math.floor(Math.random() * 2) + 1; // 1-2 скролла

      for (let i = 0; i < scrollCount; i++) {
        await page.mouse.wheel(0, Math.random() * 200 + 100); // Скролл вниз
        await this.randomDelay(600, 1200);

        // Иногда скроллим обратно (как будто что-то ищем)
        if (Math.random() < 0.3) {
          await page.mouse.wheel(0, -(Math.random() * 150 + 50)); // Скролл вверх
          await this.randomDelay(400, 800);
        }
      }

      console.log("✅ Имитация чтения страницы завершена");

    } catch (error) {
      console.warn("⚠️ Ошибка при имитации чтения страницы:", error.message);
    }
  }

  // ===============================
  // ПОИСК КНОПКИ С FALLBACK СТРАТЕГИЯМИ
  // ===============================
  async findTestCentreButton(page) {
    console.log("🔍 Поиск кнопки test-centre-change с fallback стратегиями...");

    // Список селекторов для поиска кнопки (в порядке приоритета)
    const selectors = [
      '#test-centre-change',
      'a[href*="test-centre"]',
      'button:has-text("Change test centre")',
      'a:has-text("Change test centre")',
      '.test-centre-change',
      '[data-testid*="test-centre"]',
      'a:has-text("Test centre")'
    ];

    for (const selector of selectors) {
      try {
        console.log(`🔎 Проверяем селектор: ${selector}`);

        const element = page.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 2000 });

        if (isVisible) {
          console.log(`✅ Кнопка найдена с селектором: ${selector}`);

          // Проверяем, что элемент кликабелен
          const isEnabled = await element.isEnabled();
          if (isEnabled) {
            console.log("✅ Кнопка активна и кликабельна");
            return true;
          } else {
            console.log("⚠️ Кнопка найдена, но не активна");
          }
        }

      } catch (error) {
        console.log(`❌ Селектор ${selector} не сработал: ${error.message}`);
        continue;
      }
    }

    // Дополнительный поиск по тексту с использованием XPath
    try {
      console.log("🔎 Дополнительный поиск по тексту с XPath...");

      const xpathSelectors = [
        '//a[contains(text(), "Change") and contains(text(), "centre")]',
        '//button[contains(text(), "Change") and contains(text(), "centre")]',
        '//a[contains(text(), "Test centre")]',
        '//button[contains(text(), "Test centre")]'
      ];

      for (const xpath of xpathSelectors) {
        const elements = await page.locator(`xpath=${xpath}`);
        const count = await elements.count();

        if (count > 0) {
          const isVisible = await elements.first().isVisible();
          if (isVisible) {
            console.log(`✅ Кнопка найдена через XPath: ${xpath}`);
            return true;
          }
        }
      }

    } catch (error) {
      console.warn("⚠️ XPath поиск не удался:", error.message);
    }

    console.log("❌ Кнопка test-centre-change не найдена ни одним из способов");
    return false;
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНАЯ НАВИГАЦИЯ К КНОПКЕ
  // ===============================
  async humanNavigateToButton(page, selector) {
    try {
      console.log(`🎯 Человекоподобная навигация к кнопке: ${selector}`);

      // Получаем элемент
      const element = page.locator(selector).first();

      // Скроллим к элементу, если он не видим
      await element.scrollIntoViewIfNeeded();
      await this.randomDelay(300, 600);

      // Получаем координаты элемента
      const box = await element.boundingBox();
      if (!box) {
        throw new Error("Не удалось получить координаты элемента");
      }

      console.log(`📍 Координаты кнопки: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`);

      // Человекоподобный подход к элементу
      await this.humanApproachToElement(page, box);

      console.log("✅ Навигация к кнопке завершена");

    } catch (error) {
      console.error(`❌ Ошибка навигации к кнопке ${selector}:`, error.message);
      throw error;
    }
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНЫЙ ПОДХОД К ЭЛЕМЕНТУ
  // ===============================
  async humanApproachToElement(page, elementBox) {
    try {
      // Текущая позиция мыши
      const currentMouse = await page.evaluate(() => {
        return { x: window.mouseX || 0, y: window.mouseY || 0 };
      });

      // Целевая точка внутри элемента (НЕ в центре!)
      const targetX = elementBox.x + (elementBox.width * (0.3 + Math.random() * 0.4)); // 30-70% ширины
      const targetY = elementBox.y + (elementBox.height * (0.3 + Math.random() * 0.4)); // 30-70% высоты

      console.log(`🎯 Движение мыши: (${currentMouse.x}, ${currentMouse.y}) → (${Math.round(targetX)}, ${Math.round(targetY)})`);

      // Человекоподобное движение с промежуточными точками
      await this.humanMouseMovement(page, currentMouse.x, currentMouse.y, targetX, targetY);

      // Небольшая задержка после достижения цели
      await this.randomDelay(200, 500);

      // Микро-движения для имитации точной наводки
      const microMovements = Math.floor(Math.random() * 3) + 1; // 1-3 микро-движения

      for (let i = 0; i < microMovements; i++) {
        const microX = targetX + (Math.random() - 0.5) * 10; // ±5px
        const microY = targetY + (Math.random() - 0.5) * 10; // ±5px

        await page.mouse.move(microX, microY, { steps: 2 });
        await this.randomDelay(50, 150);
      }

    } catch (error) {
      console.warn("⚠️ Ошибка человекоподобного подхода к элементу:", error.message);
      throw error;
    }
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНОЕ ДВИЖЕНИЕ МЫШИ
  // ===============================
  async humanMouseMovement(page, startX, startY, endX, endY) {
    const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const steps = Math.max(5, Math.floor(distance / 20)); // Минимум 5 шагов

    console.log(`🖱️ Человекоподобное движение на расстояние ${Math.round(distance)}px за ${steps} шагов`);

    // Создаем кривую Безье для естественного движения
    const controlPoint1X = startX + (endX - startX) * 0.25 + (Math.random() - 0.5) * 50;
    const controlPoint1Y = startY + (endY - startY) * 0.25 + (Math.random() - 0.5) * 50;
    const controlPoint2X = startX + (endX - startX) * 0.75 + (Math.random() - 0.5) * 50;
    const controlPoint2Y = startY + (endY - startY) * 0.75 + (Math.random() - 0.5) * 50;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;

      // Кубическая кривая Безье
      const x = Math.pow(1 - t, 3) * startX +
        3 * Math.pow(1 - t, 2) * t * controlPoint1X +
        3 * (1 - t) * Math.pow(t, 2) * controlPoint2X +
        Math.pow(t, 3) * endX;

      const y = Math.pow(1 - t, 3) * startY +
        3 * Math.pow(1 - t, 2) * t * controlPoint1Y +
        3 * (1 - t) * Math.pow(t, 2) * controlPoint2Y +
        Math.pow(t, 3) * endY;

      // Добавляем небольшой шум для естественности
      const noiseX = x + (Math.random() - 0.5) * 2;
      const noiseY = y + (Math.random() - 0.5) * 2;

      await page.mouse.move(noiseX, noiseY);

      // Переменная скорость движения
      const delay = 5 + Math.random() * 10; // 5-15ms между шагами
      await this.sleep(delay);
    }
  }

  // ===============================
  // STEALTH КЛИК ПО КНОПКЕ
  // ===============================
  async stealthClickButton(page, selector) {
    try {
      console.log(`🖱️ Выполняем stealth клик по кнопке: ${selector}`);

      // Проверяем доступность элемента
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 3000 });
      const isEnabled = await element.isEnabled();

      if (!isVisible || !isEnabled) {
        console.log(`❌ Кнопка не доступна: visible=${isVisible}, enabled=${isEnabled}`);
        return false;
      }

      // Предклик пауза (имитация человеческого колебания)
      await this.randomDelay(300, 800);

      // Получаем координаты для клика
      const box = await element.boundingBox();
      if (!box) {
        throw new Error("Не удалось получить координаты для клика");
      }

      // Точка клика (случайная, но в пределах кнопки)
      const clickX = box.x + (box.width * (0.2 + Math.random() * 0.6));
      const clickY = box.y + (box.height * (0.2 + Math.random() * 0.6));

      console.log(`🎯 Координаты клика: (${Math.round(clickX)}, ${Math.round(clickY)})`);

      // Человекоподобный клик с вариациями времени нажатия
      await page.mouse.move(clickX, clickY);
      await this.randomDelay(50, 150);

      // Имитируем колебание перед кликом
      const preClickMovements = Math.floor(Math.random() * 2) + 1; // 1-2 микро-движения
      for (let i = 0; i < preClickMovements; i++) {
        const microX = clickX + (Math.random() - 0.5) * 3; // ±1.5px
        const microY = clickY + (Math.random() - 0.5) * 3; // ±1.5px
        await page.mouse.move(microX, microY);
        await this.sleep(20 + Math.random() * 30); // 20-50ms
      }

      // Выполняем клик с человекоподобным временем нажатия
      await page.mouse.down();
      await this.sleep(50 + Math.random() * 100); // 50-150ms удержание
      await page.mouse.up();

      console.log("✅ Stealth клик выполнен");

      // Пост-клик задержка
      await this.randomDelay(200, 500);

      return true;

    } catch (error) {
      console.error(`❌ Ошибка stealth клика по ${selector}:`, error.message);

      // Fallback: попробуем обычный клик через Playwright
      try {
        console.log("🔄 Пробуем fallback клик...");
        await page.locator(selector).first().click({ timeout: 5000 });
        console.log("✅ Fallback клик успешен");
        return true;
      } catch (fallbackError) {
        console.error("❌ Fallback клик тоже не удался:", fallbackError.message);
        return false;
      }
    }
  }

  // ===============================
  // ОЖИДАНИЕ ЗАГРУЗКИ СТРАНИЦЫ TEST CENTRE
  // ===============================
  async waitForTestCentrePageLoad(page) {
    try {
      console.log("⏳ Ожидание загрузки страницы Test centre...");

      // Ожидаем навигацию
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

      // Дополнительная задержка для полной загрузки
      await this.randomDelay(2000, 4000);

      // Проверяем изменение URL
      const currentUrl = page.url();
      console.log(`📍 Текущий URL после клика: ${currentUrl}`);

      // Ожидаем появления элементов страницы Test centre
      const maxAttempts = 5;
      const attemptDelay = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔄 Попытка ${attempt}/${maxAttempts}: проверка загрузки страницы Test centre...`);

        // Проверяем ключевые элементы страницы
        const hasHeader = await page.locator('h1:has-text("Test centre")').isVisible({ timeout: 3000 });
        const hasSearchField = await page.locator('#test-centres-input').isVisible({ timeout: 2000 });

        if (hasHeader || hasSearchField) {
          console.log("✅ Страница Test centre успешно загружена");
          return true;
        }

        if (attempt < maxAttempts) {
          console.log(`⚠️ Страница еще не загружена, ждем ${attemptDelay}ms...`);
          await this.sleep(attemptDelay);
        }
      }

      console.log("❌ Страница Test centre не загрузилась в установленное время");
      return false;

    } catch (error) {
      console.error("❌ Ошибка ожидания загрузки страницы Test centre:", error.message);
      return false;
    }
  }

  // ===============================
  // ПРОВЕРКА СТРАНИЦЫ TEST CENTRE
  // ===============================
  async checkTestCentrePage(page) {
    try {
      console.log("🔍 Проверка страницы Test centre...");

      // Проверяем заголовок страницы
      const testCentreHeader = await page.locator('h1:has-text("Test centre")').isVisible({ timeout: 5000 });

      // Проверяем body id
      const bodyId = await page.evaluate(() => document.body.id);
      const correctBodyId = bodyId === 'page-test-centre-search';

      // Проверяем наличие поля поиска
      const searchField = await page.locator('#test-centres-input').isVisible({ timeout: 3000 });

      console.log(`📊 Test centre проверки: заголовок=${testCentreHeader}, body id=${correctBodyId}, поиск=${searchField}`);

      const isTestCentrePage = testCentreHeader && correctBodyId && searchField;

      if (isTestCentrePage) {
        console.log("✅ Успешно попали на страницу Test centre");
      } else {
        console.log("❌ Страница Test centre не найдена или неполная");
      }

      return isTestCentrePage;

    } catch (error) {
      console.warn(`⚠️ Ошибка проверки страницы Test centre: ${error.message}`);
      return false;
    }
  }

  // ===============================
  // ПРОВЕРКА ОШИБОК ЛОГИНА
  // ===============================
  async checkForLoginError(page) {
    try {
      console.log("🔍 Проверка наличия ошибок логина...");

      // Проверяем наличие секции с ошибкой
      const errorSection = await page.locator('.validation-summary-errors').isVisible({ timeout: 3000 });

      if (errorSection) {
        console.log("❌ Обнаружена секция с ошибками");

        // Пытаемся получить текст ошибки
        const errorText = await page.locator('.validation-summary-errors ul li').textContent({ timeout: 2000 });
        console.log(`📝 Текст ошибки: ${errorText}`);

        // Проверяем специфические сообщения об ошибках
        if (errorText && (
          errorText.includes("A booking can't be found") ||
          errorText.includes("booking cannot be found") ||
          errorText.includes("invalid") ||
          errorText.includes("not found")
        )) {
          return {
            hasError: true,
            message: errorText.trim(),
            type: 'invalid_credentials'
          };
        }

        return {
          hasError: true,
          message: errorText ? errorText.trim() : 'Неизвестная ошибка логина',
          type: 'unknown_login_error'
        };
      }

      // Дополнительная проверка через селекторы ошибок
      const commonErrorSelectors = [
        '.error-message',
        '.alert-danger',
        '.validation-error',
        '[role="alert"]',
        '.field-validation-error'
      ];

      for (const selector of commonErrorSelectors) {
        const errorElement = await page.locator(selector).isVisible({ timeout: 1000 });
        if (errorElement) {
          const errorText = await page.locator(selector).textContent({ timeout: 1000 });
          console.log(`❌ Найдена ошибка через селектор ${selector}: ${errorText}`);

          return {
            hasError: true,
            message: errorText ? errorText.trim() : 'Ошибка логина',
            type: 'validation_error'
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

  // ===============================
  // ОБРАБОТКА НЕКОРРЕКТНЫХ КРЕДЕНЦИАЛОВ
  // ===============================
  async handleInvalidCredentials(task, errorMessage) {
    try {
      console.log(`🚫 Обработка некорректных креденциалов для задачи ${task.id}...`);
      console.log(`📝 Сообщение об ошибке: ${errorMessage}`);

      // Отмена задачи через TasksAPI
      if (this.tasksAPI) {
        const cancelResult = await this.tasksAPI.cancelTask(task.id, {
          isLimit: false,
          isAuthError: true
        });

        // TasksAPI.cancelTask возвращает response напрямую, без поля success
        // Проверяем, что cancelResult существует (API вернул ответ)
        if (cancelResult) {
          console.log(`✅ Задача ${task.id} успешно отменена из-за некорректных креденциалов`);
          return { success: true, action: 'task_cancelled' };
        } else {
          console.log(`⚠️ Не удалось отменить задачу ${task.id}: пустой ответ от API`);
          return { success: false, action: 'cancel_failed', error: 'Empty API response' };
        }
      } else {
        console.log("⚠️ TasksAPI не инициализирован, не можем отменить задачу");
        return { success: false, action: 'no_api', error: 'TasksAPI not initialized' };
      }

    } catch (error) {
      console.error(`❌ Ошибка при обработке некорректных креденциалов: ${error.message}`);
      return { success: false, action: 'error', error: error.message };
    }
  }

  // ===============================
  // ОЧИСТКА РЕСУРСОВ
  // ===============================
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
      console.warn("⚠️ Ошибка остановки профиля:", error.message);
    }
  }

  // ===============================
  // ПОИСК ТЕСТ-ЦЕНТРА
  // ===============================
  async searchTestCentre(page, loginData) {
    try {
      console.log("🔍 Начинаем поиск тест-центра...");

      // Ждем полной загрузки страницы и скриптов
      await this.waitForPageScriptsLoaded(page);

      // Получаем тест-центр из задачи
      if (!loginData.testCenters || loginData.testCenters.length === 0) {
        throw new Error("В задаче не указаны тест-центры для поиска");
      }

      // Берем первый тест-центр из задачи
      const testCentreName = loginData.testCenters[0];
      
      // Ищем соответствующий почтовый код в наших данных
      const postcode = testCentresData[testCentreName];
      
      if (!postcode) {
        // Если точного совпадения нет, попробуем найти по частичному совпадению
        const possibleMatches = Object.keys(testCentresData).filter(name => 
          name.toLowerCase().includes(testCentreName.toLowerCase()) ||
          testCentreName.toLowerCase().includes(name.toLowerCase())
        );
        
        if (possibleMatches.length > 0) {
          const matchedName = possibleMatches[0];
          const matchedPostcode = testCentresData[matchedName];
          console.log(`🎯 Найдено частичное совпадение: "${testCentreName}" → "${matchedName}" (${matchedPostcode})`);
          
          // Используем найденное совпадение
          await this.performTestCentreSearch(page, matchedPostcode, testCentreName);
        } else {
          // Если совпадения не найдено, используем название тест-центра напрямую
          console.log(`⚠️ Почтовый код для "${testCentreName}" не найден в данных, используем название напрямую`);
          await this.performTestCentreSearch(page, testCentreName, testCentreName);
        }
      } else {
        console.log(`🎯 Выбран тест-центр из задачи: ${testCentreName} (${postcode})`);
        await this.performTestCentreSearch(page, postcode, testCentreName);
      }

      console.log("🎉 Поиск тест-центра завершен успешно");
      return true;

    } catch (error) {
      console.error("❌ Ошибка поиска тест-центра:", error.message);
      return false;
    }
  }

  // ===============================
  // ВЫПОЛНЕНИЕ ПОИСКА ТЕСТ-ЦЕНТРА
  // ===============================
  async performTestCentreSearch(page, searchTerm, testCentreName) {
    try {
      console.log(`🔍 Выполняем поиск: "${searchTerm}" для тест-центра "${testCentreName}"`);

      // Проверяем наличие поля ввода
      const inputField = await page.locator('#test-centres-input').isVisible({ timeout: 10000 });
      if (!inputField) {
        throw new Error("Поле ввода test-centres-input не найдено");
      }

      // Человекоподобная очистка и ввод поискового термина
      await this.humanSearchInput(page, '#test-centres-input', searchTerm);

      // Пауза перед кликом по кнопке поиска
      await this.randomDelay(800, 1500);

      // Проверяем наличие кнопки поиска
      const submitButton = await page.locator('#test-centres-submit').isVisible({ timeout: 5000 });
      if (!submitButton) {
        throw new Error("Кнопка поиска test-centres-submit не найдена");
      }

      // Человекоподобный клик по кнопке поиска
      await this.humanClick(page, '#test-centres-submit');
      console.log("✅ Поиск тест-центра инициирован");

      // Ждем результатов поиска
      await this.waitForSearchResults(page);

      // Анализируем результаты поиска и обрабатываем их
      const searchSuccess = await this.processSearchResults(page, testCentreName, searchTerm);
      
      return searchSuccess;

    } catch (error) {
      console.error(`❌ Ошибка выполнения поиска для "${searchTerm}":`, error.message);
      throw error;
    }
  }

  // ===============================
  // ОБРАБОТКА РЕЗУЛЬТАТОВ ПОИСКА ТЕСТ-ЦЕНТРА
  // ===============================
  async processSearchResults(page, testCentreName, searchTerm) {
    try {
      console.log(`🔍 Обработка результатов поиска для тест-центра: "${testCentreName}"`);
      
      const maxAttempts = 3;
      const maxShowMoreClicks = 2;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`📋 Попытка ${attempt}/${maxAttempts} обработки результатов`);
        
        // Анализируем текущие результаты поиска
        const analysisResult = await this.analyzeSearchResults(page, testCentreName);
        
        if (analysisResult.found && analysisResult.hasAvailableTests) {
          console.log(`✅ Найден тест-центр "${testCentreName}" с доступными датами`);
          
          // Кликаем по тест-центру с доступными датами
          const clickSuccess = await this.clickTestCentreIfAvailable(page, analysisResult.element);
          if (clickSuccess) {
            console.log("🎉 Успешно перешли к выбору времени тестирования");
            return true;
          }
        } else if (analysisResult.found && !analysisResult.hasAvailableTests) {
          console.log(`⚠️ Тест-центр "${testCentreName}" найден, но нет доступных дат`);
          
          // Пробуем "Show more results" несколько раз
          let showMoreSuccess = false;
          for (let showMoreAttempt = 1; showMoreAttempt <= maxShowMoreClicks; showMoreAttempt++) {
            console.log(`🔄 Пробуем "Show more results" (${showMoreAttempt}/${maxShowMoreClicks})`);
            
            const moreResultsSuccess = await this.handleNoTestsFound(page);
            if (moreResultsSuccess) {
              // Повторно анализируем результаты после загрузки дополнительных
              const newAnalysis = await this.analyzeSearchResults(page, testCentreName);
              if (newAnalysis.found && newAnalysis.hasAvailableTests) {
                const clickSuccess = await this.clickTestCentreIfAvailable(page, newAnalysis.element);
                if (clickSuccess) {
                  console.log("🎉 Успешно найдены доступные даты после Show more results");
                  return true;
                }
              }
            }
          }
        } else {
          console.log(`❌ Тест-центр "${testCentreName}" не найден в результатах поиска`);
        }
        
        // Если не удалось найти или нет доступных дат, пробуем повторить поиск
        if (attempt < maxAttempts) {
          console.log("🔄 Повторяем поиск с тем же поисковым термином...");
          const retrySuccess = await this.retrySearchWithSameTerm(page, searchTerm);
          if (!retrySuccess) {
            console.log("❌ Не удалось повторить поиск");
            break;
          }
        }
      }
      
      console.log(`❌ Не удалось найти доступные даты для тест-центра "${testCentreName}" после ${maxAttempts} попыток`);
      return false;
      
    } catch (error) {
      console.error("❌ Ошибка обработки результатов поиска:", error.message);
      return false;
    }
  }

  // ===============================
  // АНАЛИЗ РЕЗУЛЬТАТОВ ПОИСКА
  // ===============================
  async analyzeSearchResults(page, testCentreName) {
    try {
      console.log(`🔍 Анализ результатов для тест-центра: "${testCentreName}"`);
      
      // Ждем загрузки результатов
      await page.waitForSelector('.test-centre-results', { timeout: 10000 });
      
      // Получаем все элементы тест-центров
      const testCentres = await page.locator('.test-centre-results li').all();
      console.log(`📊 Найдено ${testCentres.length} тест-центров в результатах`);
      
      for (const centre of testCentres) {
        try {
          // Получаем название тест-центра из h4
          const centreNameElement = centre.locator('h4');
          const centreName = await centreNameElement.textContent();
          console.log(`🏢 Проверяем тест-центр: "${centreName}"`);
          
          // Проверяем, соответствует ли это искомому тест-центру
          if (this.isTestCentreNameMatch(centreName, testCentreName)) {
            console.log(`✅ Найдено соответствие: "${centreName}" ~ "${testCentreName}"`);
            
            // Проверяем наличие доступных дат
            const statusElement = centre.locator('h5');
            const statusText = await statusElement.textContent();
            console.log(`📅 Статус дат: "${statusText}"`);
            
            const hasAvailableTests = !statusText.includes('No tests found');
            
            // Получаем ссылку для клика
            const linkElement = centre.locator('a').first();
            
            return {
              found: true,
              hasAvailableTests: hasAvailableTests,
              element: linkElement,
              centreName: centreName,
              statusText: statusText
            };
          }
        } catch (elementError) {
          console.warn(`⚠️ Ошибка анализа элемента тест-центра:`, elementError.message);
          continue;
        }
      }
      
      console.log(`❌ Тест-центр "${testCentreName}" не найден в результатах`);
      return {
        found: false,
        hasAvailableTests: false,
        element: null,
        centreName: null,
        statusText: null
      };
      
    } catch (error) {
      console.error("❌ Ошибка анализа результатов поиска:", error.message);
      return { found: false, hasAvailableTests: false, element: null };
    }
  }

  // ===============================
  // ПРОВЕРКА СООТВЕТСТВИЯ НАЗВАНИЙ ТЕСТ-ЦЕНТРОВ
  // ===============================
  isTestCentreNameMatch(foundName, targetName) {
    const normalize = (name) => name.toLowerCase().replace(/[^\w\s]/g, '').trim();
    
    const normalizedFound = normalize(foundName);
    const normalizedTarget = normalize(targetName);
    
    // Точное совпадение
    if (normalizedFound === normalizedTarget) return true;
    
    // Частичное совпадение (один содержит другой)
    if (normalizedFound.includes(normalizedTarget) || normalizedTarget.includes(normalizedFound)) {
      return true;
    }
    
    // Проверяем совпадение основных слов
    const foundWords = normalizedFound.split(/\s+/);
    const targetWords = normalizedTarget.split(/\s+/);
    
    for (const targetWord of targetWords) {
      if (targetWord.length > 3) { // Игнорируем короткие слова
        for (const foundWord of foundWords) {
          if (foundWord.includes(targetWord) || targetWord.includes(foundWord)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  // ===============================
  // ЧЕЛОВЕКОПОДОБНЫЙ ВВОД В ПОЛЕ ПОИСКА
  // ===============================
  async humanSearchInput(page, selector, searchTerm) {
    try {
      console.log(`⌨️ Человекоподобный ввод поискового термина: ${searchTerm}`);

      // Фокус на поле
      await this.moveMouseToElement(page, selector);
      await page.click(selector);
      await this.randomDelay(200, 400);

      // Проверяем текущее содержимое поля
      const currentValue = await page.inputValue(selector);
      console.log(`📝 Текущее содержимое поля: "${currentValue}"`);

      // Очищаем поле человекоподобным способом
      if (currentValue && currentValue.length > 0) {
        console.log("🧹 Очищаем поле от предыдущего содержимого...");
        
        // Выделяем весь текст
        await page.keyboard.press('Control+A');
        await this.randomDelay(100, 200);
        
        // Удаляем выделенный текст
        await page.keyboard.press('Delete');
        await this.randomDelay(200, 400);
      }

      // Человекоподобный ввод нового поискового термина
      await this.humanTyping(page, selector, searchTerm);

      // Проверяем, что ввод прошел успешно
      const finalValue = await page.inputValue(selector);
      if (finalValue !== searchTerm) {
        console.warn(`⚠️ Значение в поле отличается: ожидалось "${searchTerm}", получено "${finalValue}"`);
        // Повторный ввод при необходимости
        await page.fill(selector, searchTerm);
        await this.randomDelay(300, 600);
      }

      console.log(`✅ Поисковый термин "${searchTerm}" успешно введен`);

    } catch (error) {
      console.error(`❌ Ошибка ввода в поле ${selector}:`, error.message);
      throw error;
    }
  }

  // ===============================
  // КЛИК ПО ТЕСТ-ЦЕНТРУ С ДОСТУПНЫМИ ДАТАМИ
  // ===============================
  async clickTestCentreIfAvailable(page, element) {
    try {
      console.log("🖱️ Кликаем по тест-центру с доступными датами...");
      
      // Проверяем, что элемент доступен для клика
      const isVisible = await element.isVisible({ timeout: 5000 });
      const isEnabled = await element.isEnabled();
      
      if (!isVisible || !isEnabled) {
        console.log(`❌ Элемент недоступен: visible=${isVisible}, enabled=${isEnabled}`);
        return false;
      }
      
      // Скроллим к элементу
      await element.scrollIntoViewIfNeeded();
      await this.randomDelay(500, 1000);
      
      // Человекоподобное движение к элементу и клик
      const box = await element.boundingBox();
      if (box) {
        await this.humanApproachToElement(page, box);
        await this.randomDelay(300, 700);
        
        // Stealth клик
        const clickX = box.x + (box.width * (0.2 + Math.random() * 0.6));
        const clickY = box.y + (box.height * (0.2 + Math.random() * 0.6));
        
        await page.mouse.move(clickX, clickY);
        await this.randomDelay(100, 300);
        await page.mouse.down();
        await this.sleep(50 + Math.random() * 100);
        await page.mouse.up();
        
        console.log("✅ Клик по тест-центру выполнен");
        
        // Ждем навигации на следующую страницу
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await this.randomDelay(2000, 4000);
        
        return true;
      } else {
        console.log("❌ Не удалось получить координаты элемента");
        return false;
      }
      
    } catch (error) {
      console.error("❌ Ошибка клика по тест-центру:", error.message);
      return false;
    }
  }

  // ===============================
  // ОБРАБОТКА ОТСУТСТВИЯ ТЕСТОВ - SHOW MORE RESULTS
  // ===============================
  async handleNoTestsFound(page) {
    try {
      console.log("🔄 Обрабатываем отсутствие доступных дат, ищем 'Show more results'...");
      
      // Имитируем человекоподобные движения мыши (чтение результатов)
      await this.simulateResultsReading(page);
      
      // Ищем кнопку "Show more results"
      const showMoreButton = page.locator('#fetch-more-centres');
      const isVisible = await showMoreButton.isVisible({ timeout: 5000 });
      
      if (!isVisible) {
        console.log("❌ Кнопка 'Show more results' не найдена");
        return false;
      }
      
      console.log("✅ Найдена кнопка 'Show more results', кликаем...");
      
      // Скроллим к кнопке
      await showMoreButton.scrollIntoViewIfNeeded();
      await this.randomDelay(800, 1500);
      
      // Человекоподобный клик по кнопке
      await this.humanClick(page, '#fetch-more-centres');
      
      // Ждем загрузки дополнительных результатов
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await this.randomDelay(3000, 5000);
      
      console.log("✅ Дополнительные результаты загружены");
      return true;
      
    } catch (error) {
      console.error("❌ Ошибка обработки 'Show more results':", error.message);
      return false;
    }
  }

  // ===============================
  // ИМИТАЦИЯ ЧТЕНИЯ РЕЗУЛЬТАТОВ ПОИСКА
  // ===============================
  async simulateResultsReading(page) {
    try {
      console.log("📖 Имитируем чтение результатов поиска...");
      
      // Случайные движения мыши по результатам
      const readingMovements = Math.floor(Math.random() * 4) + 3; // 3-6 движений
      
      for (let i = 0; i < readingMovements; i++) {
        // Случайные координаты в области результатов
        const x = Math.random() * 600 + 200; // 200-800px
        const y = Math.random() * 300 + 400; // 400-700px (область результатов)
        
        await page.mouse.move(x, y, {
          steps: Math.floor(Math.random() * 6) + 3 // 3-8 шагов
        });
        
        // Пауза "чтения"
        await this.randomDelay(800, 1800);
        
        // Иногда делаем скролл
        if (Math.random() < 0.3) {
          await page.mouse.wheel(0, Math.random() * 150 + 50);
          await this.randomDelay(500, 1000);
        }
      }
      
      console.log("✅ Имитация чтения результатов завершена");
      
    } catch (error) {
      console.warn("⚠️ Ошибка имитации чтения результатов:", error.message);
    }
  }

  // ===============================
  // ПОВТОРНЫЙ ПОИСК С ТЕМ ЖЕ ТЕРМИНОМ
  // ===============================
  async retrySearchWithSameTerm(page, searchTerm) {
    try {
      console.log(`🔄 Повторный поиск с термином: "${searchTerm}"`);
      
      // Случайная пауза перед повторным поиском
      await this.randomDelay(2000, 4000);
      
      // Имитируем человекоподобное поведение - движение к полю поиска
      await this.moveMouseToElement(page, '#test-centres-input');
      await this.randomDelay(300, 700);
      
      // Очищаем поле и вводим заново
      await this.humanSearchInput(page, '#test-centres-input', searchTerm);
      
      // Пауза перед кликом
      await this.randomDelay(800, 1500);
      
      // Кликаем по кнопке поиска
      await this.humanClick(page, '#test-centres-submit');
      console.log("✅ Повторный поиск инициирован");
      
      // Ждем результатов
      await this.waitForSearchResults(page);
      
      return true;
      
    } catch (error) {
      console.error("❌ Ошибка повторного поиска:", error.message);
      return false;
    }
  }

  // ===============================
  // ОЖИДАНИЕ ЗАГРУЗКИ СКРИПТОВ СТРАНИЦЫ
  // ===============================
  async waitForPageScriptsLoaded(page) {
    try {
      console.log("⏳ Ожидание загрузки скриптов страницы...");

      // Ждем networkidle
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // Ждем jQuery и готовности DOM
      await page.waitForFunction(() => {
        return typeof window.jQuery !== 'undefined' && 
               document.readyState === 'complete' &&
               window.jQuery && 
               window.jQuery.isReady;
      }, { timeout: 10000 });

      // Дополнительная пауза
      await this.sleep(2000);

      console.log("✅ Скрипты страницы загружены");

    } catch (error) {
      console.warn("⚠️ Ошибка ожидания загрузки скриптов:", error.message);
      // Продолжаем работу, даже если скрипты не загрузились полностью
    }
  }

  // ===============================
  // ОЖИДАНИЕ РЕЗУЛЬТАТОВ ПОИСКА
  // ===============================
  async waitForSearchResults(page) {
    try {
      console.log("⏳ Ожидание результатов поиска...");

      // Ждем загрузки страницы
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

      // Дополнительная пауза для загрузки результатов
      await this.randomDelay(3000, 5000);

      // Проверяем появление результатов поиска (могут быть разные селекторы)
      const possibleResultSelectors = [
        '.test-centre-results',
        '.search-results', 
        '.test-centres-list',
        '[class*="result"]',
        '[class*="centre"]'
      ];

      let resultsFound = false;
      for (const selector of possibleResultSelectors) {
        try {
          const elements = await page.locator(selector).count();
          if (elements > 0) {
            console.log(`✅ Найдены результаты поиска: ${elements} элементов с селектором ${selector}`);
            resultsFound = true;
            break;
          }
        } catch (error) {
          // Игнорируем ошибки отдельных селекторов
        }
      }

      if (!resultsFound) {
        console.log("ℹ️ Специфические результаты поиска не найдены, но страница загружена");
      }

      // Логируем текущий URL для отладки
      const currentUrl = page.url();
      console.log(`📍 URL после поиска: ${currentUrl}`);

      return true;

    } catch (error) {
      console.warn("⚠️ Ошибка ожидания результатов поиска:", error.message);
      return false;
    }
  }

  // ===============================
  // УТИЛИТЫ
  // ===============================
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    console.log("⏹️ Остановка бота...");
    this.isRunning = false;
  }
}

// ===============================
// ЭКСПОРТ
// ===============================
export { SimpleLoginBot };

// ===============================
// ЗАПУСК (только если указаны реальные credentials)
// ===============================
if (import.meta.url === `file://${process.argv[1]}`) {
  // Получаем credentials из переменных окружения
  const multiloginEmail = process.env.MULTILOGIN_EMAIL;
  const multiloginPassword = process.env.MULTILOGIN_PASSWORD;
  const captchaApiKey = process.env.RUCAPTCHA_API_KEY;
  const tasksApiToken = process.env.TASKS_API_TOKEN;
  const workerName = process.env.WORKER_NAME || "worker-1";
  console.log(`Запуск бота от имени: ${JSON.stringify(process.env)}`);
  const bot = new SimpleLoginBot(
    { email: multiloginEmail, password: multiloginPassword },
    captchaApiKey,
    tasksApiToken,
    workerName
  );

  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    console.error("❌ Ошибка запуска:", error);
  }
}