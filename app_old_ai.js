import { chromium } from "playwright";
import { CaptchaSolver } from "./captcha/solver.js";
import {
  CaptchaSolverZeroBalanceException,
  CaptchaSolverWrongKeyException,
  CaptchaSolverTimeoutException,
} from "./captcha/exceptions.js";
import { MultiloginAPI, MultiloginException } from "./multilogin/multilogin.js";
import { 
  TasksAPI, 
  TasksAPIException, 
  TasksAPIAuthException, 
  TasksAPIRateLimitException 
} from "./api/TasksAPI.js";
import fs from 'fs';

// ===============================
// КОНФИГУРАЦИЯ И КОНСТАНТЫ
// ===============================
const CONFIG = {
  MAX_RETRIES_PER_LOGIN: 3,
  MAX_CONSECUTIVE_FAILURES: 10,
  TIMEOUTS: {
    PAGE_LOAD: 60000,
    CAPTCHA_SOLVE: 120000,
    BROWSER_START: 30000,
    WEBSOCKET_CONNECT: 15000
  },
  PROXY: {
    MAX_ROTATION_ATTEMPTS: 5,
    ROTATION_DELAY: 3000,
    IP_CHANGE_TIMEOUT: 30000
  },
  BOT_DETECTION: {
    PATTERNS: [
      'Pardon Our Interruption',
      'pardon our interruption',
      'browser made us think you were a bot',
      'something about your browser made us think you were a bot',
      'super-human speed',
      'cookies and JavaScript are enabled',
      'disabled cookies in your web browser',
      'third-party browser plugin',
      'Ghostery or NoScript',
      'preventing JavaScript from running',
      'To regain access',
      'make sure that cookies and JavaScript are enabled'
    ],
    MAX_RECOVERY_ATTEMPTS: 3,
    RECOVERY_DELAYS: [45000, 90000, 180000], // увеличивающиеся задержки
    PROFILE_DELETION_DELAY: 10000
  },
  HUMAN_BEHAVIOR: {
    INITIAL_DELAY_RANGE: [2000, 8000], // случайная задержка перед анализом
    READING_DELAY_RANGE: [3000, 12000], // имитация чтения страницы  
    SCROLL_DELAY_RANGE: [1000, 3000], // задержка между скроллами
    CLICK_DELAY_RANGE: [500, 2000], // задержка перед кликами
    TYPING_DELAY_RANGE: [80, 200], // задержка между символами при печати
    MOUSE_MOVEMENT_ENABLED: true,
    RANDOM_SCROLLS: true
  },
  AUTH_BEHAVIOR: {
    FIELD_CLEAR_DELAY: [100, 300], // задержка при очистке полей
    FIELD_FOCUS_DELAY: [200, 500], // задержка фокуса на поле
    PRE_TYPE_DELAY: [300, 800], // пауза перед началом ввода
    POST_TYPE_DELAY: [500, 1200], // пауза после ввода в поле
    BUTTON_CLICK_DELAY: [800, 1500], // задержка перед кликом на кнопку
    VALIDATION_DELAY: [2000, 4000], // ожидание результата после отправки
    RETRY_DELAY: [3000, 6000] // пауза перед повтором при ошибке
  },
  DELAYS: {
    BETWEEN_LOGINS: [5000, 15000], // min, max
    RETRY_DELAYS: [10000, 30000, 60000], // по попыткам
    ERROR_DELAYS: {
      ProfileException: 30000,
      BrowserStartException: 60000,
      PageLoadException: 20000,
      CaptchaSolveException: 10000,
      LoginFailedException: 45000,
      NetworkException: 15000,
      RateLimitException: 120000,
      ProxyTimeoutException: 45000
    }
  },
  TARGET_URL: 'https://driverpracticaltest.dvsa.gov.uk/login'
};

// ===============================
// КЛАССЫ ИСКЛЮЧЕНИЙ
// ===============================
class ProfileException extends Error {
  constructor(message) {
    super(message);
    this.name = "ProfileException";
  }
}

class BrowserStartException extends Error {
  constructor(message) {
    super(message);
    this.name = "BrowserStartException";
  }
}

class PageLoadException extends Error {
  constructor(message) {
    super(message);
    this.name = "PageLoadException";
  }
}

class CaptchaSolveException extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptchaSolveException";
  }
}

class LoginFailedException extends Error {
  constructor(message) {
    super(message);
    this.name = "LoginFailedException";
  }
}

class NetworkException extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkException";
  }
}

class RateLimitException extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitException";
  }
}

class ProxyTimeoutException extends Error {
  constructor(message) {
    super(message);
    this.name = "ProxyTimeoutException";
  }
}

class CriticalException extends Error {
  constructor(message) {
    super(message);
    this.name = "CriticalException";
  }
}

class BotDetectedException extends Error {
  constructor(message, detectionData = null) {
    super(message);
    this.name = "BotDetectedException";
    this.detectionData = detectionData;
  }
}

// ===============================
// ГЛАВНЫЙ КЛАСС БОТА
// ===============================
class LoginProcessingBot {
  constructor(multiloginCredentials, captchaApiKey, tasksApiToken, workerName) {
    this.multiloginCredentials = multiloginCredentials;
    this.captchaApiKey = captchaApiKey;
    this.tasksApiToken = tasksApiToken;
    this.workerName = workerName;
    
    this.multiloginAPI = null;
    this.captchaSolver = null;
    this.tasksAPI = null;
    this.currentTask = null;
    this.pingInterval = null;
    
    this.isRunning = false;
    this.consecutiveFailures = 0;
    this.statistics = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: {},
      tasksProcessed: 0,
      tasksSuccessful: 0,
      tasksFailed: 0
    };
    
    // Настройки прокси теперь управляются через ProxyManager
  }

  // ===============================
  // 1. ИНИЦИАЛИЗАЦИЯ И НАСТРОЙКА
  // ===============================
  async initialize() {
    console.log("🚀 Инициализация бота...");
    
    await this.initializeMultiloginAPI();
    await this.initializeCaptchaSolver();
    await this.initializeTasksAPI();
    console.log("✅ Инициализация завершена");
  }

  async initializeMultiloginAPI() {
    try {
      this.multiloginAPI = new MultiloginAPI(
        this.multiloginCredentials.email, 
        this.multiloginCredentials.password
      );
      await this.multiloginAPI.apiInit();
      console.log("✅ Успешно авторизован в Multilogin API.");
    } catch (error) {
      throw new CriticalException(`Ошибка инициализации Multilogin API: ${error.message}`);
    }
  }

  async initializeCaptchaSolver() {
    this.captchaSolver = new CaptchaSolver(this.captchaApiKey);
    console.log("✅ Сервис решения капчи инициализирован.");
  }

  async initializeTasksAPI() {
    try {
      this.tasksAPI = new TasksAPI(this.tasksApiToken, this.workerName);
      console.log("✅ TasksAPI инициализирован.");
    } catch (error) {
      throw new CriticalException(`Ошибка инициализации TasksAPI: ${error.message}`);
    }
  }

  async getNextLoginFromQueue() {
    try {
      console.log("📋 Запрос следующей задачи через TasksAPI...");
      
      const task = await this.tasksAPI.getTask();
      
      if (!task) {
        console.log("⭕ Нет доступных задач");
        return null;
      }
      
      // Конвертируем задачу в формат loginData
      const loginData = this.tasksAPI.convertTaskToLoginData(task);
      
      // Сохраняем текущую задачу для ping и обновлений
      this.currentTask = task;
      
      // Запускаем ping для поддержания активности задачи
      this.startTaskPing(task.id);
      
      console.log(`✅ Получена задача: ID=${task.id}, License=${task.license}`);
      return loginData;
      
    } catch (error) {
      if (error instanceof TasksAPIException) {
        console.error(`❌ Ошибка TasksAPI: ${error.message}`);
        return null;
      }
      
      console.error(`❌ Неожиданная ошибка при получении задачи: ${error.message}`);
      return null;
    }
  }

  /**
   * Запускает периодический ping задачи
   * @param {number} taskId - ID задачи для ping
   */
  startTaskPing(taskId) {
    // Остановить предыдущий ping если есть
    this.stopTaskPing();
    
    console.log(`💗 Запуск ping для задачи ${taskId}...`);
    
    // Ping каждые 30 секунд
    this.pingInterval = setInterval(async () => {
      try {
        await this.tasksAPI.ping(taskId);
      } catch (error) {
        console.warn(`⚠️ Ошибка ping задачи ${taskId}: ${error.message}`);
      }
    }, 30000);
  }

  /**
   * Останавливает ping задачи
   */
  stopTaskPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
      console.log("⏹️ Ping задачи остановлен");
    }
  }

  // ===============================
  // 2. ГЛАВНЫЙ ЦИКЛ ПРОГРАММЫ  
  // ===============================
  async start() {
    console.log("▶️ Запуск главного цикла...");
    this.isRunning = true;
    
    while (this.isRunning) {
      try {
        // 2.1. Получить следующий логин из очереди
        const loginData = await this.getNextLoginFromQueue();
        
        if (!loginData) {
          console.log("⏳ Очередь пуста, ожидание...");
          await this.sleep(5000);
          continue;
        }

        // 2.2. Запустить обработку логина с retry-логикой
        await this.processLoginWithRetry(loginData);
        
        // 2.5. Пауза между логинами
        await this.randomDelay(CONFIG.DELAYS.BETWEEN_LOGINS);
        
      } catch (error) {
        console.error("❌ Критическая ошибка в главном цикле:", error);
        await this.handleCriticalError(error);
      }
    }
  }

  async processLoginWithRetry(loginData) {
    console.log(`🔄 Обработка логина: ${loginData.username}`);
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES_PER_LOGIN; attempt++) {
      try {
        console.log(`📝 Попытка ${attempt}/${CONFIG.MAX_RETRIES_PER_LOGIN}`);
        
        // 2.3. Выполнить полный цикл обработки логина
        await this.processLogin(loginData);
        
        // Успех - выходим из retry цикла
        await this.markLoginAsCompleted(loginData);
        this.consecutiveFailures = 0;
        this.statistics.successful++;
        console.log("✅ Логин успешно обработан");
        return;
        
      } catch (error) {
        console.error(`❌ Ошибка на попытке ${attempt}:`, error.message);
        
        // 2.4. Обработать ошибку и принять решение о повторе
        const shouldRetry = await this.handleLoginError(error, attempt, loginData);
        
        if (!shouldRetry || attempt >= CONFIG.MAX_RETRIES_PER_LOGIN) {
          await this.markLoginAsFailed(loginData, error);
          this.consecutiveFailures++;
          this.statistics.failed++;
          break;
        }
        
        // Ждать перед повтором
        const delay = CONFIG.DELAYS.RETRY_DELAYS[attempt - 1] || 60000;
        await this.sleep(delay);
      }
    }
    
    // Проверка критического количества неудач
    if (this.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
      throw new CriticalException("Слишком много последовательных неудач");
    }
  }

  // ===============================
  // 3. ЦИКЛ ОБРАБОТКИ ОДНОГО ЛОГИНА
  // ===============================
  async processLogin(loginData) {
    let browser = null;
    let profileId = null;
    
    try {
      // 3.1. Этап: Поиск/создание профиля
      profileId = await this.findOrCreateProfile(loginData);
      
      // 3.2. Этап: Запуск браузера
      browser = await this.startBrowser(profileId);
      
      // 3.3. Этап: Навигация и анализ страницы
      const pageAnalysis = await this.navigateAndAnalyzePage(browser, profileId);
      
      // 3.4. Этап: Решение капчи (если нужно)
      if (pageAnalysis.hasCaptcha) {
        await this.solveCaptcha(browser, pageAnalysis);
      }
      
      // 3.5. Этап: Процесс логина
      if (pageAnalysis.hasLoginForm) {
        await this.performLogin(browser, loginData);
      }
      
    } finally {
      // 3.6. Этап: Завершение и очистка
      await this.cleanup(browser, profileId);
    }
  }

  // ===============================
  // 3.1. ЭТАП: ПОИСК/СОЗДАНИЕ ПРОФИЛЯ
  // ===============================
  async findOrCreateProfile(loginData) {
    console.log("🔍 Поиск/создание профиля...");
    
    try {
      // Поиск существующего профиля
      const searchResult = await this.multiloginAPI.searchProfile(loginData.profileName);
      console.log("Результат поиска профиля:", searchResult.data?.profiles);
      
      let profileId = null;
      
      if (searchResult.data && searchResult.data.profiles === null) {
        // Профиль не найден - создаем новый
        console.log("Профиль не найден, создаем новый...");
        const currentProxyConfig = this.multiloginAPI.getCurrentProxy();
        const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(currentProxyConfig);
        const createResult = await this.multiloginAPI.createProfile(
          loginData.profileName, 
          formattedProxy, 
          'mimic'
        );
        
        if (createResult.status.http_code === 201) {
          profileId = createResult.data.ids[0];
          console.log("✅ Профиль создан с ID:", profileId);
        } else {
          throw new Error(`Ошибка создания профиля: ${createResult.status.message}`);
        }
      } else {
        // Профиль найден - получаем ID
        profileId = this.findProfileIdByName(searchResult, loginData.profileName);
        console.log("✅ Профиль найден с ID:", profileId);
      }
      
      if (!profileId) {
        throw new Error("Не удалось получить ID профиля");
      }
      
      return profileId;
      
    } catch (error) {
      throw new ProfileException(`Ошибка работы с профилем: ${error.message}`);
    }
  }

  findProfileIdByName(searchResult, profileName) {
    if (!searchResult?.data?.profiles || !Array.isArray(searchResult.data.profiles)) {
      return null;
    }
    
    const profile = searchResult.data.profiles.find(profile => 
      profile && profile.name === profileName
    );
    
    return profile ? profile.id : null;
  }

  // ===============================
  // 3.2. ЭТАП: ЗАПУСК БРАУЗЕРА
  // ===============================
  async startBrowser(profileId) {
    console.log("🌐 Запуск браузера...");
    
    try {
      // Запуск профиля Multilogin
      console.log(`Запуск профиля Multilogin с ID: ${profileId}`);
      const startResult = await this.multiloginAPI.startProfile(profileId);
      console.log("Результат запуска профиля:", startResult);

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
        
        // Повторный запуск после обновления прокси
        const retryStartResult = await this.multiloginAPI.startProfile(profileId);
        if (retryStartResult.status.http_code !== 200) {
          throw new Error(`Не удалось запустить профиль после обновления прокси: ${retryStartResult.status.message}`);
        }
      }

      // Получение WebSocket endpoint
      const wsEndpoint = await this.getWebSocketEndpoint(startResult);
      console.log(`✅ Профиль Multilogin запущен. WebSocket Endpoint: ${wsEndpoint}`);

      // Подключение к браузеру
      const browser = await chromium.connectOverCDP(wsEndpoint, {
        timeout: CONFIG.TIMEOUTS.WEBSOCKET_CONNECT
      });
      
      return browser;
      
    } catch (error) {
      throw new BrowserStartException(`Ошибка запуска браузера: ${error.message}`);
    }
  }

  async getWebSocketEndpoint(startResult) {
    if (!startResult.data || !startResult.data.port) {
      throw new Error("Не удалось получить WebSocket port от Multilogin.");
    }
    
    const multiloginPort = startResult.data.port;
    let wsEndpoint = null;
    const maxRetries = 10;
    const retryDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Попытка ${i + 1}/${maxRetries}: Запрос WebSocket URL по порту: ${multiloginPort}`);
        const res = await fetch(`http://127.0.0.1:${multiloginPort}/json/version`);
        
        if (!res.ok) {
          throw new Error(`Ошибка HTTP-запроса: ${res.status}`);
        }
        
        const json = await res.json();
        wsEndpoint = json.webSocketDebuggerUrl;
        
        if (wsEndpoint) {
          break;
        }
      } catch (error) {
        console.warn(`Не удалось подключиться: ${error.message}. Повторная попытка через ${retryDelay / 1000} сек...`);
        await this.sleep(retryDelay);
      }
    }

    if (!wsEndpoint) {
      throw new Error("Не удалось получить webSocketDebuggerUrl из Multilogin после нескольких попыток.");
    }

    return wsEndpoint;
  }

  // ===============================
  // 3.2.1. ОБРАБОТЧИК ДЕТЕКЦИИ БОТА И ВОССТАНОВЛЕНИЕ
  // ===============================
  async handleBotDetectionRecovery(profileId, loginData, attempt = 0) {
    console.log(`🤖 Начало восстановления после детекции бота (попытка ${attempt + 1}/${CONFIG.BOT_DETECTION.MAX_RECOVERY_ATTEMPTS})...`);
    
    try {
      // 1. Остановить текущий профиль
      console.log("⏹️ Остановка заблокированного профиля...");
      try {
        await this.multiloginAPI.stopProfile(profileId);
        console.log("✅ Профиль остановлен");
      } catch (error) {
        console.warn("⚠️ Ошибка остановки профиля:", error.message);
      }
      
      // 2. Задержка перед удалением профиля
      console.log(`⏳ Пауза ${CONFIG.BOT_DETECTION.PROFILE_DELETION_DELAY}мс перед удалением профиля...`);
      await this.sleep(CONFIG.BOT_DETECTION.PROFILE_DELETION_DELAY);
      
      // 3. Полное удаление старого профиля
      console.log("🗑️ Полное удаление заблокированного профиля...");
      try {
        await this.multiloginAPI.removeProfile(profileId, true); // permanently = true
        console.log("✅ Профиль полностью удален");
      } catch (error) {
        console.warn("⚠️ Ошибка удаления профиля:", error.message);
      }
      
      // 4. Ротация прокси для нового профиля
      console.log("🔄 Получение нового прокси для восстановления...");
      const newProxyConfig = this.multiloginAPI.getRandomizedProxy();
      console.log(`✅ Новый прокси: ${newProxyConfig.host}:${newProxyConfig.port}`);
      
      // Форматируем прокси для создания профиля (нужен объект Multilogin-формата)
      const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(newProxyConfig);
      console.log("🔧 Форматированный прокси:", formattedProxy);
      
      // 5. Создание нового профиля с тем же именем
      console.log(`📝 Создание нового профиля: ${loginData.profileName}`);
      const createResult = await this.multiloginAPI.createProfile(
        loginData.profileName,
        formattedProxy,
        'mimic' // или можно попробовать 'stealthfox'
      );
      
      if (createResult.status.http_code !== 201) {
        throw new Error(`Ошибка создания нового профиля: ${createResult.status.message}`);
      }
      
      const newProfileId = createResult.data.ids[0];
      console.log(`✅ Новый профиль создан с ID: ${newProfileId}`);
      
      // 6. Задержка восстановления (увеличивается с каждой попыткой)
      const recoveryDelay = CONFIG.BOT_DETECTION.RECOVERY_DELAYS[Math.min(attempt, CONFIG.BOT_DETECTION.RECOVERY_DELAYS.length - 1)];
      console.log(`⏳ Задержка восстановления: ${recoveryDelay / 1000} секунд...`);
      await this.sleep(recoveryDelay);
      
      console.log("✅ Восстановление после детекции бота завершено");
      return newProfileId;
      
    } catch (error) {
      console.error(`❌ Ошибка при восстановлении после детекции бота: ${error.message}`);
      throw new ProfileException(`Не удалось восстановиться после детекции бота: ${error.message}`);
    }
  }

  // ===============================
  // 3.2.2. ОБРАБОТЧИК ТАЙМАУТОВ ЗАГРУЗКИ СТРАНИЦЫ
  // ===============================
  async handlePageLoadTimeout(profileId, attempt, browser = null) {
    console.log(`⚠️ Обработка таймаута загрузки страницы (попытка ${attempt + 1})...`);
    
    try {
      // 1. Закрыть текущий браузер если есть
      if (browser) {
        try {
          await browser.close();
          console.log("🔒 Браузер закрыт из-за таймаута");
        } catch (error) {
          console.warn("⚠️ Ошибка закрытия браузера:", error.message);
        }
      }
      
      // 2. Остановить текущий профиль
      try {
        await this.multiloginAPI.stopProfile(profileId);
        console.log("⏹️ Профиль остановлен");
      } catch (error) {
        console.warn("⚠️ Ошибка остановки профиля:", error.message);
      }
      
      // 3. Ротация прокси
      console.log("🔄 Ротация прокси...");
      const newProxy = this.multiloginAPI.rotateProxy();
      
      // 4. Обновление профиля с новым прокси
      await this.multiloginAPI.updateProfileProxyWithRotation(profileId, newProxy);
      
      // 5. Пауза перед перезапуском
      console.log(`⏳ Пауза ${CONFIG.PROXY.ROTATION_DELAY}мс перед перезапуском...`);
      await this.sleep(CONFIG.PROXY.ROTATION_DELAY);
      
      console.log("✅ Обработка таймаута завершена");
      
    } catch (error) {
      console.error(`❌ Ошибка при обработке таймаута: ${error.message}`);
      throw new ProxyTimeoutException(`Не удалось обработать таймаут: ${error.message}`);
    }
  }

  // ===============================
  // 3.3. ЭТАП: НАВИГАЦИЯ И АНАЛИЗ СТРАНИЦЫ (с обработкой таймаутов)
  // ===============================
  async navigateAndAnalyzePage(browser, profileId = null) {
    console.log("📄 Навигация и анализ страницы с retry-логикой...");
    
    for (let attempt = 0; attempt < CONFIG.PROXY.MAX_ROTATION_ATTEMPTS; attempt++) {
      try {
        console.log(`🔄 Попытка навигации ${attempt + 1}/${CONFIG.PROXY.MAX_ROTATION_ATTEMPTS}`);
        
        const context = await browser.newContext();
        const page = await context.newPage();

        // Устанавливаем обработчик для новых страниц/попапов
        context.on('page', async (newPage) => {
          const url = newPage.url();
          console.log(`🆕 Новая страница обнаружена: ${url}`);
          
          // Если новая страница содержит целевой URL, переключаемся на неё
          if (url.includes('driverpracticaltest.dvsa.gov.uk')) {
            console.log('🎯 Переключение на новое окно с целевым URL');
            await newPage.bringToFront();
          }
        });

        console.log("🌐 Переход на целевую страницу...");
        // Открытие целевой страницы с обработкой таймаута
        await page.goto(CONFIG.TARGET_URL, {
          waitUntil: 'domcontentloaded',
          timeout: CONFIG.TIMEOUTS.PAGE_LOAD
        });
        
        // Проверяем, не открылась ли целевая страница в новом окне
        await this.sleep(2000); // Даём время для возможного открытия нового окна
        const allPages = context.pages();
        
        let targetPage = page;
        for (const p of allPages) {
          const url = p.url();
          if (url.includes('driverpracticaltest.dvsa.gov.uk') && !url.includes('chrome://')) {
            console.log(`🎯 Найдена целевая страница в другом окне: ${url}`);
            targetPage = p;
            break;
          }
        }
        
        console.log(`✅ Страница загружена успешно: ${targetPage.url()}`);

        return await this.processPageAnalysis(targetPage, context);
        
      } catch (error) {
        console.error(`❌ Ошибка навигации на попытке ${attempt + 1}: ${error.message}`);
        
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
          console.log("⏰ Обнаружен таймаут загрузки страницы");
          
          if (attempt < CONFIG.PROXY.MAX_ROTATION_ATTEMPTS - 1 && profileId) {
            // Обработать таймаут и ротацию прокси
            await this.handlePageLoadTimeout(profileId, attempt, browser);
            
            // Перезапустить браузер с новым прокси
            browser = await this.restartBrowserWithNewProxy(profileId);
            continue;
          } else {
            throw new PageLoadException(`Страница не загружается после ${CONFIG.PROXY.MAX_ROTATION_ATTEMPTS} попыток ротации прокси`);
          }
        } else if (error instanceof BotDetectedException) {
          console.log("🤖 Обнаружена детекция бота во время навигации");
          
          if (attempt < CONFIG.BOT_DETECTION.MAX_RECOVERY_ATTEMPTS && profileId) {
            // Обработать детекцию бота и пересоздать профиль
            console.log(`🔄 Запуск восстановления после детекции бота (попытка ${attempt + 1})...`);
            const newProfileId = await this.handleBotDetectionRecovery(profileId, { profileName: `TEMP_${Date.now()}` }, attempt);
            
            // Перезапустить браузер с новым профилем
            browser = await this.startBrowser(newProfileId);
            
            // Обновить profileId для следующих попыток
            profileId = newProfileId;
            continue;
          } else {
            throw new BotDetectedException(`Детекция бота не удалось обойти после ${CONFIG.BOT_DETECTION.MAX_RECOVERY_ATTEMPTS} попыток`);
          }
        } else {
          // Другие ошибки - не связанные с прокси
          if (attempt < 2) {
            console.log("⏳ Повторная попытка навигации через 5 секунд...");
            await this.sleep(5000);
            continue;
          }
          throw new PageLoadException(`Ошибка навигации: ${error.message}`);
        }
      }
    }
  }

  // ===============================
  // 3.3.1. ПЕРЕЗАПУСК БРАУЗЕРА С НОВЫМ ПРОКСИ
  // ===============================
  async restartBrowserWithNewProxy(profileId) {
    console.log("🔄 Перезапуск браузера с новым прокси...");
    
    try {
      // Запуск профиля с новым прокси
      const browser = await this.startBrowser(profileId);
      console.log("✅ Браузер перезапущен с новым прокси");
      return browser;
    } catch (error) {
      throw new BrowserStartException(`Не удалось перезапустить браузер: ${error.message}`);
    }
  }

  // ===============================
  // 3.3.2. ОБРАБОТКА АНАЛИЗА СТРАНИЦЫ 
  // ===============================
  async processPageAnalysis(page, context) {
    try {
      // Человекоподобная задержка перед анализом
      const [initMin, initMax] = CONFIG.HUMAN_BEHAVIOR.INITIAL_DELAY_RANGE;
      const initialDelay = Math.random() * (initMax - initMin) + initMin;
      console.log(`⏳ Имитация человеческой задержки: ${Math.round(initialDelay / 1000)} секунд...`);
      await page.waitForTimeout(initialDelay);
      
      // Случайное человекоподобное поведение (временно отключено)
      // await this.simulateHumanBehavior(page);
      
      console.log("✅ Человекоподобная подготовка завершена, начинаем анализ...");

      // 1. СНАЧАЛА проверяем основную страницу на блокировку бота
      console.log("🔍 Проверка основной страницы на блокировку бота...");
      const mainPageAnalysis = await this.checkMainPageForBotDetection(page);
      
      if (mainPageAnalysis.isBlocked) {
        console.error(`🚫 ДЕТЕКЦИЯ БОТА НА ОСНОВНОЙ СТРАНИЦЕ!`);
        console.error(`📝 Паттерн: ${mainPageAnalysis.detectedPattern}`);
        console.error(`📄 Контекст: ${mainPageAnalysis.context}`);
        throw new BotDetectedException(
          `Обнаружена детекция бота: ${mainPageAnalysis.message}`, 
          mainPageAnalysis
        );
      }

      // 2. ПОТОМ проверяем наличие iframe
      console.log("🔍 Проверка наличия iframe...");
      let hasIframe = false;
      try {
        await page.waitForSelector('#main-iframe', { timeout: 10000 });
        hasIframe = true;
        console.log("✅ Iframe найден");
      } catch (error) {
        console.warn("⚠️ Iframe не найден в течение 10 секунд");
      }

      let captchaData = { status: 'no-iframe' };
      
      // 3. Если iframe есть - анализируем его содержимое
      if (hasIframe) {
        console.log("🔍 Анализ содержимого iframe...");
        try {
          captchaData = await Promise.race([
            this.analyzeCaptchaInIframe(page),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout analyzing iframe')), 15000)
            )
          ]);
          console.log('✅ Результат анализа iframe:', captchaData);
          
          // Проверка на детекцию бота в iframe
          if (captchaData.status === 'bot-detected') {
            console.error(`🚫 ДЕТЕКЦИЯ БОТА В IFRAME!`);
            console.error(`📝 Паттерн: ${captchaData.detectedPattern}`);
            console.error(`📄 Контекст: ${captchaData.context}`);
            throw new BotDetectedException(
              `Обнаружена детекция бота в iframe: ${captchaData.message}`,
              captchaData
            );
          }
        } catch (error) {
          console.error("❌ Ошибка или таймаут при анализе iframe:", error.message);
          captchaData = { status: 'analysis-failed', error: error.message };
        }
      }

      console.log("🔍 Проверка формы логина...");
      const hasLoginForm = await this.checkForLoginForm(page);
      console.log(`✅ Форма логина: ${hasLoginForm ? 'найдена' : 'не найдена'}`);

      return {
        page,
        context,
        hasCaptcha: captchaData.status === 'ready',
        hasLoginForm,
        isBlocked: captchaData.status === 'blocked',
        isLoggedIn: false, // TODO: реализовать проверку
        captchaData
      };
      
    } catch (error) {
      throw new PageLoadException(`Ошибка анализа страницы: ${error.message}`);
    }
  }

  async checkMainPageForBotDetection(page) {
    console.log("🔍 Анализ основной страницы на детекцию бота...");
    
    try {
      // Быстрая проверка title на "Pardon Our Interruption"
      console.log("📋 Получаем title страницы...");
      const pageTitle = await page.evaluate(() => document.title);
      console.log(`📋 Title страницы: "${pageTitle}"`);
      
      console.log("🌐 Получаем URL страницы...");
      const pageUrl = page.url();
      console.log(`🌐 URL страницы: ${pageUrl}`);
      
      const titleLower = pageTitle.toLowerCase();
      
      if (titleLower.includes('pardon our interruption')) {
        console.log(`🚫 ДЕТЕКЦИЯ БОТА В TITLE! Найден "Pardon Our Interruption"`);
        return {
          isBlocked: true,
          detectedPattern: 'pardon our interruption',
          message: `Детекция бота в title: "Pardon Our Interruption"`,
          context: `Title: ${pageTitle}`,
          pageTitle,
          pageUrl
        };
      }
      
      console.log("✅ Title чистый - детекция бота не обнаружена");
      return {
        isBlocked: false,
        message: "Страница прошла проверку по title",
        pageTitle,
        pageUrl
      };
      
    } catch (error) {
      console.error("❌ Ошибка проверки title:", error.message);
      return {
        isBlocked: false,
        message: "Ошибка проверки title",
        error: error.message
      };
    }
  }

  async analyzeCaptchaInIframe(page) {
    console.log("🔍 Выполнение анализа iframe...");
    
    return await page.evaluate(() => {
      console.log("📋 Начало анализа в evaluate...");
      
      const targetIframe = document.getElementById("main-iframe");
      
      if (!targetIframe) {
        console.log("❌ Iframe с ID 'main-iframe' не найден");
        return { "sitekey": null, "siteurl": null, "ua": null, "status": "no-iframe" };
      }
      
      if (!targetIframe.contentWindow) {
        console.log("❌ contentWindow недоступен");
        return { "sitekey": null, "siteurl": null, "ua": null, "status": "no-iframe" };
      }
      
      console.log("✅ Iframe найден, получаем документ...");
      
      let iframeDocument;
      try {
        iframeDocument = targetIframe.contentWindow.document;
        console.log("✅ Документ iframe получен");
      } catch (error) {
        console.log("❌ Ошибка доступа к документу iframe:", error.message);
        return { "sitekey": null, "siteurl": null, "ua": null, "status": "access-denied" };
      }

      // Проверка на блокировку по классу error-code
      console.log("🔍 Проверка error-code...");
      const isBlocked = iframeDocument.getElementsByClassName("error-code").length > 0;
      if (isBlocked) {
        console.log("🚫 Найден error-code - страница заблокирована");
        return { "sitekey": false, "siteurl": false, "ua": window.navigator.userAgent, "status": "blocked" };
      }

      // Проверка на детекцию бота в iframe
      console.log("🔍 Проверка текста iframe на детекцию бота...");
      const bodyText = iframeDocument.body ? iframeDocument.body.innerText || iframeDocument.body.textContent : '';
      const pageText = bodyText.toLowerCase();
      const titleText = iframeDocument.title ? iframeDocument.title.toLowerCase() : '';
      
      console.log(`📄 Первые 300 символов iframe: ${bodyText.substring(0, 300)}`);
      console.log(`📋 Title iframe: ${iframeDocument.title}`);
      
      // Проверка паттернов детекции бота
      const patterns = [
        'pardon our interruption',
        'browser made us think you were a bot',
        'something about your browser made us think you were a bot',
        'super-human speed',
        'cookies and javascript are enabled',
        'disabled cookies in your web browser',
        'third-party browser plugin',
        'ghostery or noscript',
        'preventing javascript from running',
        'to regain access'
      ];
      
      for (const pattern of patterns) {
        if (pageText.includes(pattern) || titleText.includes(pattern)) {
          console.log(`🚫 IFRAME: ДЕТЕКЦИЯ БОТА! Найден паттерн: "${pattern}"`);
          const contextStart = Math.max(0, pageText.indexOf(pattern) - 50);
          const contextEnd = pageText.indexOf(pattern) + pattern.length + 50;
          console.log(`📍 Контекст: ${bodyText.substring(contextStart, contextEnd)}`);
          
          return { 
            "sitekey": false, 
            "siteurl": false, 
            "ua": window.navigator.userAgent, 
            "status": "bot-detected",
            "message": `Детекция бота в iframe по паттерну: "${pattern}"`,
            "detectedPattern": pattern,
            "context": bodyText.substring(0, 500)
          };
        }
      }

      console.log("🔍 Получение URL страницы...");
      const siteurl = iframeDocument.location.href;
      console.log(`🌐 URL: ${siteurl}`);
      
      console.log("🔍 Поиск hCaptcha элементов...");
      const hcaptchaElements = iframeDocument.getElementsByClassName("h-captcha");
      console.log(`🧩 Найдено hCaptcha элементов: ${hcaptchaElements.length}`);
      
      if (hcaptchaElements.length === 0) {
        console.log("❌ hCaptcha элементы не найдены");
        return { "sitekey": null, "siteurl": siteurl, "ua": window.navigator.userAgent, "status": "no-captcha" };
      }
      
      const sitekey = hcaptchaElements[0].getAttribute("data-sitekey");
      console.log(`🔑 Найден sitekey: ${sitekey}`);
      
      return { "sitekey": sitekey, "siteurl": siteurl, "ua": window.navigator.userAgent, "status": "ready" };
    });
  }

  async checkForLoginForm(page) {
    try {
      return await page.locator('#page-login').isVisible();
    } catch (error) {
      console.warn("Ошибка проверки формы логина:", error.message);
      return false;
    }
  }

  // ===============================
  // 3.4. ЭТАП: РЕШЕНИЕ КАПЧИ
  // ===============================
  async solveCaptcha(browser, pageAnalysis) {
    console.log("🧩 Решение капчи...");
    
    try {
      const { captchaData, page } = pageAnalysis;
      
      if (captchaData.status !== 'ready' || !captchaData.sitekey || !captchaData.siteurl) {
        throw new Error("Некорректные данные капчи");
      }

      console.log('hCaptcha готова к решению. Отправляем на сервис...');
      
      // Решение капчи
      const hcaptchaToken = await this.captchaSolver.solveHcaptcha(
        captchaData.siteurl,
        captchaData.sitekey,
        captchaData.ua
      );
      
      console.log('✅ hCaptcha успешно решена! Токен получен');

      // Случайная задержка и скролл после решения
      const postCaptchaDelay = Math.random() * 7000 + 3000;
      console.log(`Ожидание случайного времени после отправки капчи: ${Math.round(postCaptchaDelay / 1000)} секунд...`);
      await page.waitForTimeout(postCaptchaDelay);

      const scrollAmount = Math.floor(Math.random() * 500) + 100;
      console.log(`Выполнение случайной прокрутки страницы на ${scrollAmount} пикселей...`);
      await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);

      // Передача токена в iframe
      await this.submitCaptchaTokenToIframe(page, hcaptchaToken);
      
      console.log('✅ Капча успешно решена и токен передан');
      
    } catch (error) {
      if (error instanceof CaptchaSolverZeroBalanceException) {
        throw new CaptchaSolveException('Пожалуйста, пополните баланс Rucaptcha.');
      } else if (error instanceof CaptchaSolverWrongKeyException) {
        throw new CaptchaSolveException('Проверьте ваш API ключ Rucaptcha.');
      } else if (error instanceof CaptchaSolverTimeoutException) {
        throw new CaptchaSolveException('Время ожидания решения капчи истекло.');
      } else {
        throw new CaptchaSolveException(`Ошибка решения капчи: ${error.message}`);
      }
    }
  }

  async submitCaptchaTokenToIframe(page, token) {
    console.log('Попытка передать токен hCaptcha в iframe...');
    
    await page.evaluate(({ token }) => {
      const targetIframe = document.getElementById("main-iframe");
      
      if (targetIframe && targetIframe.contentWindow) {
        const iframeWindow = targetIframe.contentWindow;
        
        // Проверяем функцию onCaptchaFinished
        if (typeof iframeWindow.onCaptchaFinished === 'function') {
          iframeWindow.onCaptchaFinished(token);
          console.log('Токен hCaptcha успешно передан через onCaptchaFinished.');
        } else {
          // Попытка вставить в скрытое поле
          const hCaptchaResponseField = iframeWindow.document.querySelector('[name="h-captcha-response"]');
          if (hCaptchaResponseField) {
            hCaptchaResponseField.value = token;
            console.log('Токен hCaptcha вставлен в скрытое поле.');
          } else {
            console.warn('Не удалось найти способ передачи токена капчи.');
          }
        }
      } else {
        console.error('Iframe с ID "main-iframe" не найден или недоступен.');
      }
    }, { token });
  }

  // ===============================
  // 3.5. ЭТАП: ПРОЦЕСС ЛОГИНА  
  // ===============================

  // ===============================
  // 3.5.1. СИСТЕМА ДИАГНОСТИКИ И ОТЛАДКИ
  // ===============================

  /**
   * Сохраняет текущее состояние страницы для отладки
   * @param {object} page - Playwright page объект
   * @param {string} stage - Этап процесса (before-auth, after-submit, etc.)
   * @param {object} additionalInfo - Дополнительная информация
   */
  async savePageState(page, stage, additionalInfo = {}) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `debug_${stage}_${timestamp}`;
      
      console.log(`🔬 Сохранение состояния страницы: ${stage}`);
      
      // Создаем папку для отладочных файлов
      const debugDir = './debug';
      await this.ensureDirectoryExists(debugDir);
      
      // Сохраняем скриншот
      await page.screenshot({ 
        path: `${debugDir}/${filename}.png`,
        fullPage: true 
      });
      console.log(`📷 Скриншот: ${debugDir}/${filename}.png`);
      
      // Сохраняем HTML
      const html = await page.content();
      fs.writeFileSync(`${debugDir}/${filename}.html`, html);
      console.log(`📄 HTML: ${debugDir}/${filename}.html`);
      
      // Сохраняем информацию о странице
      const pageInfo = {
        timestamp: new Date().toISOString(),
        stage,
        url: page.url(),
        title: await page.title().catch(() => 'Unknown'),
        viewport: await page.viewportSize(),
        additionalInfo,
        cookies: await page.context().cookies().catch(() => [])
      };
      
      fs.writeFileSync(
        `${debugDir}/${filename}.json`, 
        JSON.stringify(pageInfo, null, 2)
      );
      console.log(`📋 Информация: ${debugDir}/${filename}.json`);
      
      return {
        screenshotPath: `${debugDir}/${filename}.png`,
        htmlPath: `${debugDir}/${filename}.html`,
        infoPath: `${debugDir}/${filename}.json`
      };
      
    } catch (error) {
      console.error("❌ Ошибка сохранения состояния страницы:", error.message);
      return null;
    }
  }

  /**
   * Создает директорию если её нет
   * @param {string} dir - Путь к директории
   */
  async ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  /**
   * Создает сводный отчет по диагностике
   * @param {object} loginData - Данные для авторизации
   * @param {string} errorMessage - Описание ошибки
   */
  async createDiagnosticReport(loginData, errorMessage) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportFile = `./debug/diagnostic_report_${timestamp}.json`;
      
      const report = {
        timestamp: new Date().toISOString(),
        username: loginData.username,
        error: errorMessage,
        summary: "Отчет по диагностике проблемы с авторизацией",
        recommendations: [
          "Проверьте скриншоты и HTML файлы в папке debug",
          "Особое внимание на URL изменения после отправки формы",
          "Если URL меняется на chrome://new-tab-page/ - проверьте селектор кнопки логина",
          "Проверьте корректность данных авторизации"
        ],
        debugFiles: {
          info: "Все скриншоты и HTML файлы сохранены в папке ./debug",
          keyStages: [
            "perform-login-start - начало процесса авторизации",
            "before-form-fill - перед заполнением формы",
            "before-form-submit - перед отправкой формы",
            "after-form-submit - после отправки формы",
            "navigation-error - ошибки навигации",
            "final-auth-result - финальный результат"
          ]
        }
      };
      
      await this.ensureDirectoryExists('./debug');
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      
      console.log(`📊 Создан диагностический отчет: ${reportFile}`);
      
      return reportFile;
      
    } catch (error) {
      console.error("❌ Ошибка создания диагностического отчета:", error.message);
      return null;
    }
  }

  // ===============================
  // 3.5.2. ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ АВТОРИЗАЦИИ
  // ===============================

  /**
   * Получает активную страницу из браузера
   * @param {object} browser - Playwright browser объект
   * @returns {object} Активная страница
   */
  async getActivePage(browser) {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('Нет доступных контекстов браузера');
    }
    
    const pages = await contexts[0].pages();
    if (pages.length === 0) {
      throw new Error('Нет открытых страниц');
    }
    
    // Ищем страницу с нужным URL (не chrome://new-tab-page)
    for (const page of pages) {
      const url = page.url();
      if (!url.includes('chrome://new-tab-page') && 
          !url.includes('about:blank') && 
          !url.includes('chrome://newtab')) {
        console.log(`✅ Найдена активная страница: ${url}`);
        return page;
      }
    }
    
    // Если не найдена подходящая страница, используем последнюю
    console.log(`⚠️ Используем последнюю страницу: ${pages[pages.length - 1].url()}`);
    return pages[pages.length - 1];
  }

  /**
   * Очищает поле ввода человекоподобным способом
   * @param {object} page - Playwright page объект
   * @param {string} selector - Селектор поля
   */
  async clearInputField(page, selector) {
    try {
      console.log(`🧹 Очистка поля ${selector}...`);
      
      // Фокус на поле
      await page.click(selector);
      await this.sleep(Math.random() * 200 + 100);
      
      // Выделение всего текста (Ctrl+A / Cmd+A)
      const isMac = process.platform === 'darwin';
      const modifierKey = isMac ? 'Meta' : 'Control';
      
      await page.keyboard.press(`${modifierKey}+a`);
      await this.sleep(Math.random() * 150 + 50);
      
      // Удаление
      await page.keyboard.press('Backspace');
      await this.sleep(Math.random() * 100 + 50);
      
      console.log(`✅ Поле очищено`);
      
    } catch (error) {
      console.warn(`⚠️ Ошибка очистки поля: ${error.message}`);
      // Fallback к простой очистке
      await page.fill(selector, '');
    }
  }

  /**
   * Заполняет поле формы с валидацией
   * @param {object} page - Playwright page объект
   * @param {string} selector - Селектор поля
   * @param {string} value - Значение для ввода
   * @param {string} fieldName - Название поля для логов
   */
  async fillAuthField(page, selector, value, fieldName) {
    try {
      console.log(`📝 Заполнение поля "${fieldName}"...`);
      
      // Ожидание видимости поля
      await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
      
      // Очистка поля
      await this.clearInputField(page, selector);
      
      // Пауза перед вводом
      const preTypeDelay = Math.random() * 500 + 300;
      await this.sleep(preTypeDelay);
      
      // Человекоподобный ввод
      await this.humanTypeText(page, selector, value);
      
      // Валидация ввода
      const actualValue = await page.inputValue(selector);
      if (actualValue !== value) {
        console.warn(`⚠️ Предупреждение: введенное значение не совпадает с ожидаемым`);
        console.warn(`Ожидалось: "${value}", получено: "${actualValue}"`);
      }
      
      console.log(`✅ Поле "${fieldName}" заполнено успешно`);
      
    } catch (error) {
      throw new Error(`Ошибка заполнения поля "${fieldName}": ${error.message}`);
    }
  }

  /**
   * Ожидает один из нескольких элементов с таймаутом
   * @param {object} page - Playwright page объект
   * @param {Array} selectors - Массив селекторов для ожидания
   * @param {number} timeout - Таймаут в миллисекундах
   * @returns {object} Найденный элемент и его селектор
   */
  async waitForAnyElement(page, selectors, timeout = 30000) {
    try {
      console.log(`⏳ Ожидание одного из элементов: ${selectors.join(', ')}`);
      
      const promises = selectors.map(selector => 
        page.waitForSelector(selector, { state: 'visible', timeout })
          .then(element => ({ element, selector }))
          .catch(() => null)
      );
      
      const result = await Promise.race(promises);
      
      if (result && result.element) {
        console.log(`✅ Найден элемент: ${result.selector}`);
        return result;
      }
      
      throw new Error(`Ни один из элементов не найден за ${timeout}мс`);
      
    } catch (error) {
      throw new Error(`Ошибка ожидания элементов: ${error.message}`);
    }
  }

  /**
   * Проверяет наличие элемента без ожидания
   * @param {object} page - Playwright page объект  
   * @param {string} selector - Селектор элемента
   * @returns {boolean} True если элемент существует и видим
   */
  async isElementVisible(page, selector) {
    try {
      // Устанавливаем короткий таймаут для быстрой проверки
      await page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  // ===============================
  // 3.5.2. ОПРЕДЕЛЕНИЕ СОСТОЯНИЯ СТРАНИЦЫ АВТОРИЗАЦИИ
  // ===============================

  /**
   * Константы селекторов для авторизации
   */
  get AUTH_SELECTORS() {
    return {
      // Поля логина (проверены по реальной HTML структуре)
      LICENSE_NUMBER: '#driving-licence-number',
      REFERENCE_NUMBER: '#application-reference-number', 
      LOGIN_BUTTON: '#booking-login',
      
      // Результаты авторизации (появляются ПОСЛЕ успешного логина)
      CONFIRM_BOOKING: '#confirm-booking-details',
      ERROR_SUMMARY: '.error-summary, section[class*="error-summary"], .validation-summary-errors',
      TEST_CENTRE_CHANGE: '#test-centre-change',
      
      // Особые состояния
      PAGE_LOGIN: '#page-login',  // body имеет id="page-login" на странице логина
      MAIN_IFRAME: '#main-iframe',
      LOGIN_FORM: 'form[action="/login"]', // Основная форма логина
      LOGIN_HEADER: 'h1', // "Enter details below to access your booking"
      
      // Ошибки и предупреждения  
      ERROR_MESSAGE: '.error-message, .validation-summary-errors, .error',
      CANCELLED_TEST: 'h1:has-text("test has been cancelled")',
      
      // Дополнительные проверки для определения страницы логина
      DRIVING_LICENCE_LABEL: 'label[for="driving-licence-number"]',
      FORM_FIELDSET: 'form fieldset'
    };
  }

  /**
   * Состояния страницы авторизации
   */
  get AUTH_STATES() {
    return {
      LOGIN_REQUIRED: 'login_required',       // Нужна авторизация
      ALREADY_AUTHORIZED: 'already_authorized', // Уже авторизован
      CAPTCHA_NEEDED: 'captcha_needed',        // Нужна капча
      AUTH_ERROR: 'auth_error',                // Ошибка авторизации
      TEST_CANCELLED: 'test_cancelled',        // Тест отменен
      LOADING: 'loading',                      // Страница загружается
      UNKNOWN: 'unknown'                       // Неизвестное состояние
    };
  }

  /**
   * Определяет текущее состояние страницы авторизации
   * @param {object} page - Playwright page объект
   * @returns {object} Состояние страницы и дополнительная информация
   */
  async detectAuthPageState(page) {
    console.log("🔍 Определение состояния страницы авторизации...");
    
    try {
      // Ожидание полной загрузки страницы
      console.log("⏳ Ожидание полной загрузки DOM...");
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await this.sleep(2000); // Дополнительная пауза для стабилизации
      
      // Сохраняем состояние страницы для диагностики
      await this.savePageState(page, 'page-state-detection', {
        step: 'detectAuthPageState start'
      });
      
      // Проверка на капчу (высший приоритет)
      if (await this.isElementVisible(page, this.AUTH_SELECTORS.MAIN_IFRAME)) {
        console.log("🧩 Обнаружена капча");
        return {
          state: this.AUTH_STATES.CAPTCHA_NEEDED,
          message: "Требуется решение капчи",
          needsAction: true
        };
      }
      
      // Проверка на уже авторизованное состояние (эти элементы появляются ПОСЛЕ логина)
      const currentUrl = page.url();
      console.log(`🌐 Текущий URL: ${currentUrl}`);
      
      // ИСПРАВЛЕНИЕ: Проверяем конкретные URL для определения авторизации
      const isOnLoginPage = currentUrl.includes('/login');
      const isNewTabPage = currentUrl.includes('chrome://new-tab-page') || currentUrl.includes('about:blank');
      const isOnManagePage = currentUrl.includes('/manage') || currentUrl.includes('/booking');
      
      console.log(`🔍 Анализ URL:`);
      console.log(`  - На странице логина: ${isOnLoginPage}`);
      console.log(`  - Новая вкладка: ${isNewTabPage}`);
      console.log(`  - На странице управления: ${isOnManagePage}`);
      
      // Если это новая вкладка или пустая страница - что-то пошло не так
      if (isNewTabPage) {
        console.log("⚠️ Обнаружена новая/пустая вкладка - возможная ошибка навигации");
        await this.savePageState(page, 'new-tab-error', {
          originalUrl: currentUrl,
          issue: 'Navigation to new tab page detected'
        });
        
        return {
          state: this.AUTH_STATES.UNKNOWN,
          message: "Ошибка навигации - страница не загрузилась",
          currentUrl,
          needsAction: false,
          navigationError: true
        };
      }
      
      // Если мы на странице управления/бронирования, то авторизованы
      if (isOnManagePage) {
        console.log("✅ Пользователь уже авторизован (на странице управления)");
        
        // Проверяем доступность функций управления тестом
        const hasTestCentreChange = await this.isElementVisible(page, this.AUTH_SELECTORS.TEST_CENTRE_CHANGE);
        const hasConfirmBooking = await this.isElementVisible(page, this.AUTH_SELECTORS.CONFIRM_BOOKING);
        
        if (hasTestCentreChange || hasConfirmBooking) {
          return {
            state: this.AUTH_STATES.ALREADY_AUTHORIZED,
            message: "Пользователь авторизован, доступны функции управления тестом",
            needsAction: false,
            hasTestCentreAccess: true
          };
        } else {
          return {
            state: this.AUTH_STATES.TEST_CANCELLED,
            message: "Авторизация есть, но тест отменен или недоступен", 
            needsAction: false,
            hasTestCentreAccess: false
          };
        }
      }
      
      // Проверка на ошибки авторизации
      if (await this.isElementVisible(page, this.AUTH_SELECTORS.ERROR_SUMMARY)) {
        const errorText = await page.textContent(this.AUTH_SELECTORS.ERROR_SUMMARY).catch(() => 'Неизвестная ошибка');
        console.log("❌ Обнаружена ошибка авторизации:", errorText);
        
        return {
          state: this.AUTH_STATES.AUTH_ERROR,
          message: `Ошибка авторизации: ${errorText}`,
          errorText,
          needsAction: false
        };
      }
      
      // Проверка на отмененный тест
      if (await this.isElementVisible(page, this.AUTH_SELECTORS.CANCELLED_TEST)) {
        console.log("🚫 Тест отменен");
        return {
          state: this.AUTH_STATES.TEST_CANCELLED,
          message: "Тест отменен или недоступен",
          needsAction: false
        };
      }
      
      // Проверка на форму логина с детальным логированием
      console.log("🔍 Проверка элементов формы логина...");
      
      // Сначала проверим, что мы на странице логина
      const isLoginPage = await this.isElementVisible(page, this.AUTH_SELECTORS.PAGE_LOGIN);
      const hasLoginForm = await this.isElementVisible(page, this.AUTH_SELECTORS.LOGIN_FORM);
      console.log(`📋 Страница логина (body#page-login): ${isLoginPage ? 'найдена' : 'НЕ найдена'}`);
      console.log(`📝 Форма логина: ${hasLoginForm ? 'найдена' : 'НЕ найдена'}`);
      
      if (isLoginPage && hasLoginForm) {
        // Проверяем основные поля формы
        console.log(`🔍 Поле лицензии (${this.AUTH_SELECTORS.LICENSE_NUMBER}):`);
        const hasLicenseField = await this.isElementVisible(page, this.AUTH_SELECTORS.LICENSE_NUMBER);
        console.log(`📄 Результат: ${hasLicenseField ? 'найдено' : 'НЕ найдено'}`);
        
        console.log(`🔍 Поле референса (${this.AUTH_SELECTORS.REFERENCE_NUMBER}):`);
        const hasReferenceField = await this.isElementVisible(page, this.AUTH_SELECTORS.REFERENCE_NUMBER);
        console.log(`📄 Результат: ${hasReferenceField ? 'найдено' : 'НЕ найдено'}`);
        
        console.log(`🔍 Кнопка входа (${this.AUTH_SELECTORS.LOGIN_BUTTON}):`);
        const hasLoginButton = await this.isElementVisible(page, this.AUTH_SELECTORS.LOGIN_BUTTON);
        console.log(`🔘 Результат: ${hasLoginButton ? 'найдена' : 'НЕ найдена'}`);
        
        if (hasLicenseField && hasReferenceField && hasLoginButton) {
          console.log("✅ Найдена полная форма логина со всеми элементами");
          return {
            state: this.AUTH_STATES.LOGIN_REQUIRED,
            message: "Требуется заполнение формы логина",
            needsAction: true,
            hasAllFields: true
          };
        } else {
          // Если форма есть, но не все поля загружены
          console.log("⚠️ Форма логина найдена, но не все поля доступны");
          return {
            state: this.AUTH_STATES.LOADING,
            message: "Форма логина загружается",
            needsAction: true,
            partialLoad: true,
            hasLicenseField,
            hasReferenceField,
            hasLoginButton
          };
        }
      }
      
      // Дополнительная проверка: если мы на странице логина, но форма не найдена
      if (isOnLoginPage) {
        console.log("🔍 На странице логина, но форма не обнаружена - проверяем элементы...");
        const licenseFieldOnly = await this.isElementVisible(page, this.AUTH_SELECTORS.LICENSE_NUMBER);
        const referenceFieldOnly = await this.isElementVisible(page, this.AUTH_SELECTORS.REFERENCE_NUMBER);
        const loginButtonOnly = await this.isElementVisible(page, this.AUTH_SELECTORS.LOGIN_BUTTON);
        
        console.log(`🔍 Прямая проверка элементов:`);
        console.log(`  - Поле лицензии: ${licenseFieldOnly}`);
        console.log(`  - Поле референса: ${referenceFieldOnly}`);
        console.log(`  - Кнопка входа: ${loginButtonOnly}`);
        
        if (licenseFieldOnly && referenceFieldOnly && loginButtonOnly) {
          console.log("✅ Все элементы формы найдены - форма готова!");
          return {
            state: this.AUTH_STATES.LOGIN_REQUIRED,
            message: "Форма логина обнаружена и готова к заполнению",
            needsAction: true,
            hasAllFields: true
          };
        }
        
        if (licenseFieldOnly || referenceFieldOnly || loginButtonOnly) {
          console.log("⚠️ Найдены отдельные элементы формы, возможно страница загружается");
          return {
            state: this.AUTH_STATES.LOADING,
            message: "Элементы формы найдены, ожидание полной загрузки",
            needsAction: true,
            partialLoad: true
          };
        }
      }
      
      // Неизвестное состояние - детальная диагностика
      console.log("❓ Неизвестное состояние страницы");
      const pageTitle = await page.title().catch(() => 'Unknown');
      
      // Дополнительная диагностика
      console.log(`📋 Заголовок страницы: ${pageTitle}`);
      console.log(`🌐 URL страницы: ${currentUrl}`);
      console.log(`🔍 Результаты проверок:`);
      console.log(`  - Поле лицензии (${this.AUTH_SELECTORS.LICENSE_NUMBER}): ${licenseFieldOnly}`);
      console.log(`  - Поле референса (${this.AUTH_SELECTORS.REFERENCE_NUMBER}): ${referenceFieldOnly}`);
      console.log(`  - Кнопка входа (${this.AUTH_SELECTORS.LOGIN_BUTTON}): ${loginButtonOnly}`);
      
      // Попробуем найти элементы альтернативными способами
      console.log("🔍 Дополнительная диагностика страницы...");
      
      try {
        const allInputs = await page.locator('input').count();
        const allButtons = await page.locator('button').count();  
        const allLinks = await page.locator('a').count();
        console.log(`📊 Всего элементов: inputs=${allInputs}, buttons=${allButtons}, links=${allLinks}`);
        
        // Попробуем найти элементы по частичным селекторам
        const licenseInputByName = await page.locator('input[id*="licence"], input[name*="licence"]').count();
        const refInputByName = await page.locator('input[id*="reference"], input[name*="reference"]').count();
        const loginButtonByValue = await page.locator('input[type="submit"], button[type="submit"]').count();
        
        console.log(`🔍 Поиск по частичным селекторам:`);
        console.log(`  - Поля с "licence": ${licenseInputByName}`);
        console.log(`  - Поля с "reference": ${refInputByName}`);
        console.log(`  - Кнопки submit: ${loginButtonByValue}`);
        
      } catch (diagError) {
        console.warn("⚠️ Ошибка диагностики:", diagError.message);
      }
      
      return {
        state: this.AUTH_STATES.UNKNOWN,
        message: "Неизвестное состояние страницы",
        pageTitle,
        currentUrl,
        hasLicenseField: licenseFieldOnly,
        hasReferenceField: referenceFieldOnly, 
        hasLoginButton: loginButtonOnly,
        needsAction: false
      };
      
    } catch (error) {
      console.error("❌ Ошибка определения состояния:", error.message);
      return {
        state: this.AUTH_STATES.UNKNOWN,
        message: `Ошибка анализа страницы: ${error.message}`,
        error: error.message,
        needsAction: false
      };
    }
  }

  /**
   * Ожидает изменения состояния страницы после действия
   * @param {object} page - Playwright page объект
   * @param {number} timeout - Таймаут ожидания в миллисекундах
   * @returns {object} Новое состояние страницы
   */
  async waitForAuthStateChange(page, timeout = 30000) {
    console.log("⏳ Ожидание изменения состояния авторизации...");
    
    const startTime = Date.now();
    let lastState = null;
    
    while (Date.now() - startTime < timeout) {
      const currentState = await this.detectAuthPageState(page);
      
      // Если состояние изменилось и это не загрузка
      if (currentState.state !== this.AUTH_STATES.LOADING && 
          currentState.state !== lastState?.state) {
        
        console.log(`✅ Состояние изменилось на: ${currentState.state}`);
        return currentState;
      }
      
      lastState = currentState;
      await this.sleep(1000); // Проверяем каждую секунду
    }
    
    throw new Error(`Тайм-аут ожидания изменения состояния (${timeout}мс)`);
  }

  // ===============================
  // 3.5.3. ОСНОВНОЙ ПРОЦЕСС АВТОРИЗАЦИИ
  // ===============================

  /**
   * Заполняет форму логина человекоподобным способом
   * @param {object} page - Playwright page объект
   * @param {object} loginData - Данные для авторизации
   * @returns {object} Результат заполнения формы
   */
  async fillLoginForm(page, loginData) {
    console.log("📝 Заполнение формы логина...");
    
    try {
      // Сохраняем состояние перед заполнением
      await this.savePageState(page, 'before-form-fill', {
        username: loginData.username,
        step: 'Starting form fill'
      });
      
      // Валидация входных данных
      if (!loginData.username || !loginData.password) {
        throw new Error("Отсутствуют данные для авторизации (username/password)");
      }
      
      console.log(`👤 Авторизация пользователя: ${loginData.username}`);
      
      // Заполнение поля номера водительских прав
      await this.fillAuthField(
        page, 
        this.AUTH_SELECTORS.LICENSE_NUMBER, 
        loginData.username,
        "Номер водительских прав"
      );
      
      // Пауза между полями
      const [delayMin, delayMax] = CONFIG.AUTH_BEHAVIOR.POST_TYPE_DELAY;
      const interFieldDelay = Math.random() * (delayMax - delayMin) + delayMin;
      console.log(`⏳ Пауза между полями: ${Math.round(interFieldDelay)}мс`);
      await this.sleep(interFieldDelay);
      
      // Заполнение поля референс номера
      await this.fillAuthField(
        page,
        this.AUTH_SELECTORS.REFERENCE_NUMBER,
        loginData.password,
        "Референс номер заявки"
      );
      
      // Финальная пауза перед отправкой
      const [btnDelayMin, btnDelayMax] = CONFIG.AUTH_BEHAVIOR.BUTTON_CLICK_DELAY;
      const preSubmitDelay = Math.random() * (btnDelayMax - btnDelayMin) + btnDelayMin;
      console.log(`⏳ Пауза перед отправкой формы: ${Math.round(preSubmitDelay)}мс`);
      await this.sleep(preSubmitDelay);
      
      console.log("✅ Форма заполнена, готова к отправке");
      return {
        success: true,
        message: "Форма успешно заполнена"
      };
      
    } catch (error) {
      console.error("❌ Ошибка заполнения формы:", error.message);
      throw new Error(`Не удалось заполнить форму логина: ${error.message}`);
    }
  }

  /**
   * Отправляет форму логина и ожидает результат
   * @param {object} page - Playwright page объект
   * @returns {object} Результат отправки формы
   */
  async submitLoginForm(page) {
    console.log("🚀 Отправка формы логина...");
    
    try {
      // Запоминаем текущий URL перед отправкой
      const initialUrl = page.url();
      console.log(`📍 URL перед отправкой формы: ${initialUrl}`);
      
      // Сохраняем состояние перед отправкой
      await this.savePageState(page, 'before-form-submit', {
        step: 'About to submit login form',
        initialUrl: initialUrl
      });
      
      // Слушатель навигации для отслеживания изменений URL
      let navigationOccurred = false;
      let finalUrl = initialUrl;
      
      const navigationPromise = page.waitForNavigation({ timeout: 15000 }).then((response) => {
        navigationOccurred = true;
        finalUrl = page.url();
        console.log(`🔄 Навигация произошла: ${initialUrl} → ${finalUrl}`);
        if (response) {
          console.log(`📊 Статус ответа: ${response.status()}`);
        }
        return response;
      }).catch(err => {
        console.log(`⚠️ Навигация не произошла или произошла ошибка: ${err.message}`);
        return null;
      });
      
      // Клик по кнопке входа
      await this.humanClick(page, this.AUTH_SELECTORS.LOGIN_BUTTON);
      console.log("✅ Форма отправлена");
      
      // Ожидаем навигацию или таймаут
      await navigationPromise;
      
      // Дополнительная пауза для стабилизации
      await this.sleep(3000);
      
      // Проверяем финальный URL
      const currentUrl = page.url();
      console.log(`📍 Финальный URL: ${currentUrl}`);
      
      // Сохраняем состояние сразу после отправки
      await this.savePageState(page, 'after-form-submit', {
        step: 'Form submitted, checking response',
        initialUrl,
        finalUrl,
        currentUrl,
        navigationOccurred
      });
      
      // Проверяем не произошла ли ошибочная навигация
      if (currentUrl.includes('chrome://new-tab-page') || currentUrl.includes('about:blank')) {
        console.error("❌ Обнаружена ошибочная навигация на новую вкладку!");
        await this.savePageState(page, 'navigation-error', {
          initialUrl,
          problemUrl: currentUrl,
          issue: 'Navigation to new tab after form submit'
        });
        
        throw new Error(`Ошибочная навигация после отправки формы: ${initialUrl} → ${currentUrl}`);
      }
      
      // Ожидание изменения состояния страницы
      console.log("⏳ Ожидание ответа на отправку формы...");
      const result = await this.waitForAuthStateChange(page, 30000);
      
      // Сохраняем финальное состояние
      await this.savePageState(page, 'final-auth-result', {
        step: 'Authentication completed',
        result: result
      });
      
      return {
        success: true,
        authState: result,
        message: "Форма успешно отправлена"
      };
      
    } catch (error) {
      console.error("❌ Ошибка отправки формы:", error.message);
      throw new Error(`Не удалось отправить форму: ${error.message}`);
    }
  }

  /**
   * Выполняет полный процесс авторизации
   * @param {object} page - Playwright page объект
   * @param {object} loginData - Данные для авторизации
   * @returns {object} Результат авторизации
   */
  async executeLoginFlow(page, loginData) {
    console.log("🔑 Выполнение процесса авторизации...");
    
    try {
      // 1. Заполнение формы
      await this.fillLoginForm(page, loginData);
      
      // 2. Отправка формы
      const submitResult = await this.submitLoginForm(page);
      
      // 3. Анализ результата
      const authState = submitResult.authState;
      
      switch (authState.state) {
        case this.AUTH_STATES.ALREADY_AUTHORIZED:
          console.log("✅ Авторизация успешна!");
          return {
            success: true,
            state: authState.state,
            message: authState.message,
            hasTestCentreAccess: authState.hasTestCentreAccess
          };
          
        case this.AUTH_STATES.AUTH_ERROR:
          console.log("❌ Ошибка авторизации:", authState.errorText);
          throw new LoginFailedException(`Авторизация неудачна: ${authState.errorText}`);
          
        case this.AUTH_STATES.TEST_CANCELLED:
          console.log("🚫 Тест отменен");
          throw new LoginFailedException("Тест отменен или недоступен");
          
        case this.AUTH_STATES.CAPTCHA_NEEDED:
          console.log("🧩 Требуется решение капчи");
          return {
            success: false,
            state: authState.state,
            message: "Требуется решение капчи",
            needsCaptcha: true
          };
          
        default:
          console.log("❓ Неожиданное состояние:", authState.state);
          throw new LoginFailedException(`Неожиданное состояние авторизации: ${authState.state}`);
      }
      
    } catch (error) {
      if (error instanceof LoginFailedException) {
        throw error;
      }
      throw new LoginFailedException(`Процесс авторизации неудачен: ${error.message}`);
    }
  }

  async performLogin(browser, loginData) {
    console.log("🔐 Выполнение входа...");
    
    try {
      // 1. Получение активной страницы
      const page = await this.getActivePage(browser);
      console.log("✅ Получена активная страница");
      
      // Диагностика: сохраняем начальное состояние страницы
      await this.savePageState(page, 'perform-login-start', {
        step: 'Starting performLogin method',
        username: loginData.username
      });
      
      // 2. Определение состояния страницы
      const pageState = await this.detectAuthPageState(page);
      console.log(`📊 Состояние страницы: ${pageState.state}`);
      console.log(`📝 Описание: ${pageState.message}`);
      
      // Диагностика: сохраняем состояние после детекции
      if (pageState.navigationError) {
        await this.savePageState(page, 'navigation-error-detected', {
          step: 'Navigation error detected in performLogin',
          pageState: pageState
        });
      }
      
      // 3. Выбор стратегии действий
      switch (pageState.state) {
        case this.AUTH_STATES.LOGIN_REQUIRED:
          console.log("📋 Требуется авторизация - выполняем заполнение формы");
          const loginResult = await this.executeLoginFlow(page, loginData);
          
          if (loginResult.needsCaptcha) {
            console.log("🧩 Авторизация требует решения капчи");
            return {
              success: false,
              needsCaptcha: true,
              message: "Требуется решение капчи перед авторизацией"
            };
          }
          
          return {
            success: loginResult.success,
            message: loginResult.message,
            hasTestCentreAccess: loginResult.hasTestCentreAccess
          };
          
        case this.AUTH_STATES.ALREADY_AUTHORIZED:
          console.log("✅ Пользователь уже авторизован");
          return {
            success: true,
            message: "Пользователь уже авторизован",
            hasTestCentreAccess: pageState.hasTestCentreAccess,
            alreadyAuthorized: true
          };
          
        case this.AUTH_STATES.CAPTCHA_NEEDED:
          console.log("🧩 Обнаружена капча - требуется решение");
          return {
            success: false,
            needsCaptcha: true,
            message: "Обнаружена капча, требуется решение перед авторизацией"
          };
          
        case this.AUTH_STATES.AUTH_ERROR:
          throw new LoginFailedException(`Ошибка на странице авторизации: ${pageState.errorText}`);
          
        case this.AUTH_STATES.TEST_CANCELLED:
          throw new LoginFailedException("Тест отменен или недоступен");
          
        case this.AUTH_STATES.LOADING:
          console.log("⏳ Страница загружается, ожидание...");
          await this.sleep(3000);
          
          // Повторная проверка состояния
          const newState = await this.detectAuthPageState(page);
          if (newState.state === this.AUTH_STATES.LOGIN_REQUIRED) {
            return this.performLogin(browser, loginData);
          } else {
            throw new LoginFailedException("Страница не загрузилась корректно");
          }
          
        default:
          throw new LoginFailedException(`Неизвестное состояние страницы: ${pageState.state}`);
      }
      
    } catch (error) {
      // Создаем диагностический отчет при ошибке
      await this.createDiagnosticReport(loginData, error.message);
      
      if (error instanceof LoginFailedException) {
        throw error;
      }
      throw new LoginFailedException(`Ошибка авторизации: ${error.message}`);
    }
  }

  // ===============================
  // 3.6. ЭТАП: ЗАВЕРШЕНИЕ И ОЧИСТКА
  // ===============================
  async cleanup(browser, profileId) {
    console.log("🧹 Очистка ресурсов...");
    
    try {
      if (browser) {
        await browser.close();
        console.log("✅ Браузер закрыт");
      }
      
      if (profileId && this.multiloginAPI) {
        await this.multiloginAPI.stopProfile(profileId);
        console.log("✅ Профиль Multilogin остановлен");
      }
    } catch (error) {
      console.error("⚠️ Ошибка при очистке:", error.message);
    }
  }

  // ===============================
  // 4. СИСТЕМА ОБРАБОТКИ ОШИБОК
  // ===============================
  async handleLoginError(error, attempt, loginData) {
    console.error(`🚨 Обработка ошибки: ${error.name}`);
    
    this.statistics.errors[error.name] = (this.statistics.errors[error.name] || 0) + 1;
    
    if (error instanceof CriticalException) {
      return false;
    }
    
    // Специальная обработка детекции бота
    if (error instanceof BotDetectedException) {
      console.log("🤖 Обнаружена детекция бота - пересоздание профиля...");
      await this.recreateProfileAfterBotDetection(loginData);
      return attempt < CONFIG.MAX_RETRIES_PER_LOGIN;
    }
    
    if (error instanceof RateLimitException) {
      console.log("⏳ Rate limit - длительная пауза...");
      await this.sleep(CONFIG.DELAYS.ERROR_DELAYS.RateLimitException);
    }
    
    return attempt < CONFIG.MAX_RETRIES_PER_LOGIN;
  }

  async recreateProfileAfterBotDetection(loginData) {
    console.log("🔄 Начинаем процесс пересоздания профиля...");
    
    try {
      // 1. Найти текущий профиль
      const searchResult = await this.multiloginAPI.searchProfile(loginData.profileName);
      const currentProfileId = this.findProfileIdByName(searchResult, loginData.profileName);
      
      if (currentProfileId) {
        console.log(`🗑️ Остановка профиля: ${currentProfileId}`);
        
        // 2. Остановить профиль
        try {
          await this.multiloginAPI.stopProfile(currentProfileId);
          console.log("✅ Профиль остановлен");
        } catch (error) {
          console.warn("⚠️ Ошибка остановки профиля:", error.message);
        }
        
        // 3. Удалить профиль
        console.log(`🗑️ Удаление профиля: ${currentProfileId}`);
        try {
          await this.multiloginAPI.removeProfile(currentProfileId, true); // permanently = true
          console.log("✅ Профиль удален");
        } catch (error) {
          console.warn("⚠️ Ошибка удаления профиля:", error.message);
        }
      }
      
      // 4. Создать новый профиль с тем же именем  
      console.log(`📝 Создание нового профиля: ${loginData.profileName}`);
      const newProxyConfig = this.multiloginAPI.getRandomizedProxy();
      const formattedProxy = this.multiloginAPI.proxyManager.formatForMultilogin(newProxyConfig);
      const createResult = await this.multiloginAPI.createProfile(
        loginData.profileName,
        formattedProxy,
        'mimic'
      );
      
      if (createResult.status.http_code === 201) {
        const newProfileId = createResult.data.ids[0];
        console.log(`✅ Новый профиль создан с ID: ${newProfileId}`);
      } else {
        throw new Error(`Ошибка создания нового профиля: ${createResult.status.message}`);
      }
      
      // 5. Пауза перед повторной попыткой
      console.log("⏳ Пауза перед повторной попыткой...");
      await this.sleep(CONFIG.DELAYS.ERROR_DELAYS.BotDetectedException);
      
    } catch (error) {
      console.error("❌ Ошибка при пересоздании профиля:", error.message);
      throw new ProfileException(`Не удалось пересоздать профиль: ${error.message}`);
    }
  }

  getRandomizedProxy() {
    // Используем ProxyManager для получения рандомизированного прокси
    return this.multiloginAPI.getRandomizedProxy();
  }

  async handleCriticalError(error) {
    console.error("💥 Критическая ошибка:", error);
    
    if (error instanceof CriticalException) {
      console.log("⏸️ Программа приостановлена на 5 минут...");
      await this.sleep(300000);
      this.consecutiveFailures = 0;
    }
  }

  async markLoginAsCompleted(loginData) {
    console.log(`✅ Логин ${loginData.username} помечен как обработанный`);
    
    // Остановить ping задачи
    this.stopTaskPing();
    
    // Если это задача из API, отметить как успешную
    if (loginData.taskId && this.currentTask) {
      try {
        console.log(`🎉 Отмечаем задачу ${loginData.taskId} как успешную...`);
        
        // TODO: Здесь нужно получить реальные данные о найденной дате и центре
        // Пока используем placeholder данные
        const foundDate = "Available slot found"; 
        const testCenter = this.currentTask.test_centers ? this.currentTask.test_centers[0] : "Unknown";
        
        await this.tasksAPI.successTask(loginData.taskId, foundDate, testCenter);
        
        this.statistics.tasksSuccessful++;
        console.log(`✅ Задача ${loginData.taskId} помечена как успешная в API`);
        
      } catch (error) {
        console.error(`❌ Ошибка при отметке задачи как успешной: ${error.message}`);
      }
      
      this.currentTask = null;
    }
    
    this.statistics.processed++;
  }

  async markLoginAsFailed(loginData, error) {
    console.log(`❌ Логин ${loginData.username} помечен как проблемный: ${error.message}`);
    
    // Остановить ping задачи
    this.stopTaskPing();
    
    // Если это задача из API, отменить её с соответствующими флагами
    if (loginData.taskId && this.currentTask) {
      try {
        console.log(`🚫 Отменяем задачу ${loginData.taskId} из-за ошибки...`);
        
        // Определяем причину отмены по типу ошибки
        const cancelOptions = {};
        
        if (error instanceof TasksAPIAuthException || 
            error.name === 'LoginFailedException' ||
            error.message.toLowerCase().includes('auth')) {
          cancelOptions.isAuthError = true;
          console.log("🔐 Отмена из-за ошибки авторизации");
        }
        
        if (error instanceof TasksAPIRateLimitException || 
            error.name === 'RateLimitException' ||
            error.message.toLowerCase().includes('limit')) {
          cancelOptions.isLimit = true;
          console.log("⏳ Отмена из-за лимитов");
        }
        
        await this.tasksAPI.cancelTask(loginData.taskId, cancelOptions);
        
        this.statistics.tasksFailed++;
        console.log(`✅ Задача ${loginData.taskId} отменена в API`);
        
      } catch (apiError) {
        console.error(`❌ Ошибка при отмене задачи: ${apiError.message}`);
      }
      
      this.currentTask = null;
    }
    
    this.statistics.processed++;
  }

  // ===============================
  // 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ===============================
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Получить случайную задержку в заданном диапазоне
   * @param {number[]} range - [min, max] в миллисекундах
   * @returns {number} Случайная задержка
   */
  getRandomDelay(range) {
    const [min, max] = range;
    return Math.random() * (max - min) + min;
  }

  /**
   * Симуляция человекоподобного поведения на странице
   * @param {object} page - Playwright page объект
   */
  async simulateHumanBehavior(page) {
    try {
      console.log("🎭 Симуляция человекоподобного поведения...");
      
      // Случайное скролление для имитации чтения
      if (CONFIG.HUMAN_BEHAVIOR.RANDOM_SCROLLS) {
        const scrollCount = Math.floor(Math.random() * 3) + 1; // 1-3 скролла
        
        for (let i = 0; i < scrollCount; i++) {
          const scrollAmount = Math.floor(Math.random() * 300) + 100; // 100-400px
          console.log(`📜 Случайный скролл ${i + 1}: ${scrollAmount}px`);
          
          await page.evaluate((amount) => {
            window.scrollBy(0, amount);
          }, scrollAmount);
          
          // Задержка между скроллами
          const [min, max] = CONFIG.HUMAN_BEHAVIOR.SCROLL_DELAY_RANGE;
          const scrollDelay = Math.random() * (max - min) + min;
          console.log(`⏳ Пауза между скроллами: ${Math.round(scrollDelay)}мс`);
          await this.sleep(scrollDelay);
        }
        
        // Вернуться наверх
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      
      // Имитация чтения страницы
      const [readMin, readMax] = CONFIG.HUMAN_BEHAVIOR.READING_DELAY_RANGE;
      const readingDelay = Math.random() * (readMax - readMin) + readMin;
      console.log(`📖 Имитация чтения страницы: ${Math.round(readingDelay / 1000)} секунд...`);
      await this.sleep(readingDelay);
      
      // Случайное движение мыши (если поддерживается)
      if (CONFIG.HUMAN_BEHAVIOR.MOUSE_MOVEMENT_ENABLED) {
        await this.simulateMouseMovement(page);
      }
      
      console.log("✅ Человекоподобное поведение завершено");
      
    } catch (error) {
      console.warn("⚠️ Ошибка симуляции человекоподобного поведения:", error.message);
      // Не прерываем выполнение, это не критично
    }
  }

  /**
   * Симуляция случайных движений мыши
   * @param {object} page - Playwright page объект
   */
  async simulateMouseMovement(page) {
    try {
      const movements = Math.floor(Math.random() * 3) + 2; // 2-4 движения
      
      for (let i = 0; i < movements; i++) {
        const x = Math.floor(Math.random() * 800) + 100; // случайные координаты
        const y = Math.floor(Math.random() * 600) + 100;
        
        await page.mouse.move(x, y);
        await this.sleep(Math.random() * 500 + 200); // задержка между движениями
      }
      
      console.log(`🖱️ Выполнено ${movements} случайных движений мыши`);
    } catch (error) {
      console.warn("⚠️ Ошибка движения мыши:", error.message);
    }
  }

  /**
   * Человекоподобное заполнение поля ввода
   * @param {object} page - Playwright page объект  
   * @param {string} selector - CSS селектор поля
   * @param {string} text - Текст для ввода
   */
  async humanTypeText(page, selector, text) {
    try {
      console.log(`⌨️ Человекоподобный ввод текста в ${selector}...`);
      
      // Очистить поле
      await page.fill(selector, '');
      
      // Ввод по символам с случайными задержками
      const [typeMin, typeMax] = CONFIG.HUMAN_BEHAVIOR.TYPING_DELAY_RANGE;
      for (let i = 0; i < text.length; i++) {
        const typingDelay = Math.random() * (typeMax - typeMin) + typeMin;
        await page.type(selector, text[i], {
          delay: typingDelay
        });
      }
      
      console.log(`✅ Текст введен человекоподобно: ${text.length} символов`);
      
    } catch (error) {
      console.warn(`⚠️ Ошибка ввода текста: ${error.message}`);
      // Fallback к обычному вводу
      await page.fill(selector, text);
    }
  }

  /**
   * Человекоподобный клик с задержкой
   * @param {object} page - Playwright page объект
   * @param {string} selector - CSS селектор элемента
   */
  async humanClick(page, selector) {
    try {
      console.log(`🖱️ Человекоподобный клик по ${selector}...`);
      
      // Задержка перед кликом
      const [clickMin, clickMax] = CONFIG.HUMAN_BEHAVIOR.CLICK_DELAY_RANGE;
      const clickDelay = Math.random() * (clickMax - clickMin) + clickMin;
      await this.sleep(clickDelay);
      
      // Наведение мыши перед кликом
      await page.hover(selector);
      await this.sleep(Math.random() * 300 + 100);
      
      // Клик
      await page.click(selector);
      
      console.log(`✅ Клик выполнен`);
      
    } catch (error) {
      console.warn(`⚠️ Ошибка клика: ${error.message}`);
      throw error;
    }
  }

  async randomDelay([min, max]) {
    const delay = Math.random() * (max - min) + min;
    console.log(`⏳ Случайная задержка: ${Math.round(delay / 1000)}с`);
    await this.sleep(delay);
  }

  async stop() {
    console.log("⏹️ Остановка бота...");
    this.isRunning = false;
  }

  async logStatistics() {
    console.log("📊 Статистика:", this.statistics);
  }
}

// ===============================
// ТОЧКА ВХОДА В ПРОГРАММУ
// ===============================
async function main() {
  const RUCAPTCHA_API_KEY = "fc25a9852b6acd9fda597bc8a24b7b9c";
  const MULTILOGIN_EMAIL = 'dtchubmoon@gmail.com';
  const MULTILOGIN_PASSWORD = '22M#1cBV_DN+';
  const TASKS_API_TOKEN = "3ccb7d83742e941ae30739cb8c49555a144a3533ccfe96d5e675c7de096424dc";
  const WORKER_NAME = "Server1";

  const bot = new LoginProcessingBot(
    { email: MULTILOGIN_EMAIL, password: MULTILOGIN_PASSWORD },
    RUCAPTCHA_API_KEY,
    TASKS_API_TOKEN,
    WORKER_NAME
  );

  try {
    await bot.initialize();
    
    // Запуск главного цикла с реальными задачами из API
    console.log("🚀 Запуск бота с TasksAPI интеграцией...");
    await bot.start();
    
  } catch (error) {
    console.error("💥 Фатальная ошибка:", error);
    
    // Остановить ping если есть активная задача
    if (bot.pingInterval) {
      bot.stopTaskPing();
    }
    
    process.exit(1);
  }
}

// Запуск программы
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { LoginProcessingBot };