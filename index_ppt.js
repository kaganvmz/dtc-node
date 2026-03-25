// import axios from "axios";
import puppeteerExtra from "puppeteer-extra";
const RUCAPTCHA_API_KEY = "fc25a9852b6acd9fda597bc8a24b7b9c"
const MULTILOGIN_EMAIL='dtchubmoon@gmail.com';
const MULTILOGIN_PASSWORD='22M#1cBV_DN+';
import { CaptchaSolver } from "./captcha/solver.js";
import {
  CaptchaSolverZeroBalanceException,
  CaptchaSolverWrongKeyException,
  CaptchaSolverTimeoutException,
} from "./captcha/exceptions.js";
import { MultiloginAPI, MultiloginException } from "./multilogin/multilogin.js";

async function runPuppeteer() {
  console.log('Starting Puppeteer script...');
  // puppeteerExtra.use(stealthPlugin());
  let browser;
  const payload = [];
   // --- Настройки прокси ---
  const PROXY_HOST = 'g6ip.com';
  const PROXY_PORT = 8564;
  const PROXY_USERNAME = '4TriAKbP';
  const PROXY_PASSWORD = 'pkvoBaFN';
  const proxy = {
    "host": "gate.multilogin.com", 
    "password": "x0sxun0ssc",
    "port": 1080, 
    "type": "socks5", 
    "username": "2235440328_ab94f23e_bbdc_41c6_b3a5_146189889db5_multilogin_com-country-gb-region-england-sid-BvpafzV7-filter-medium",
};
  const mla = new MultiloginAPI(MULTILOGIN_EMAIL, MULTILOGIN_PASSWORD);
  await mla.apiInit();
  console.log("✅ Успешно авторизован в Multilogin API.");
  
  let profileId = '2f1defd6-855d-4ba9-b64b-293846478825';
  const searchProfileResult = await mla.searchProfile('MUIR9758279SJ9GN');
  console.log("Результат поиска профиля:", searchProfileResult);
  if (searchProfileResult.data && searchProfileResult.data.profiles === null) {
    console.log("Профиль не найден, создаем новый...");
    const createProfileResult = await mla.createProfile('MUIR9758279SJ9GN', proxy, 'mimic');
    if(createProfileResult.status.http_code === 201) {
      profileId = createProfileResult.data.ids[0];
    }
    console.log("Результат создания профиля:", createProfileResult);
  }
  

  console.log(`Запуск профиля Multilogin с ID: ${profileId}`);
  const startResult = await mla.startProfile(profileId);
  console.log(startResult);
  if (startResult.status.http_code !== 200 && startResult.status.error_code === 'GET_PROXY_CONNECTION_IP_ERROR') {
    const updateResult =  await mla.updateProfileProxy(profileId,  'gate.multilogin.com:1080:2235440328_ab94f23e_bbdc_41c6_b3a5_146189889db5_multilogin_com-country-gb-region-england-sid-BvpafzV7-filter-medium:x0sxun0ssc');
    console.log("✅ Профиль успешно обновлён с новым прокси:", updateResult);
  }
  // Получаем WebSocket endpoint из ответа Multilogin
  if (!startResult.data || !startResult.data.port) {
    throw new MultiloginException("Не удалось получить WebSocket port от Multilogin.");
  }
  const multiloginPort = startResult.data.port;
   

  let wsEndpoint = null;
    const maxRetries = 10;
    const retryDelay = 1000; // 1 секунда

    // Добавляем цикл повторных попыток для получения WebSocket URL
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
                break; // Успешно получили URL, выходим из цикла
            }
        } catch (error) {
            console.warn(`Не удалось подключиться: ${error.message}. Повторная попытка через ${retryDelay / 1000} сек...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    if (!wsEndpoint) {
      throw new Error("Не удалось получить webSocketDebuggerUrl из Multilogin после нескольких попыток.");
    }

    console.log(`✅ Профиль Multilogin запущен. WebSocket Endpoint: ${wsEndpoint}`);

  try {
    browser = await puppeteerExtra.connect({
      browserWSEndpoint: wsEndpoint
    });
  } catch (error) {
    console.error("❌ Ошибка при подключении к Multilogin:", error);
  }
  const pages = await browser.pages();
  let page = null;  
  page = await browser.newPage();
   
  console.log(`Используется прокси: ${PROXY_HOST}:${PROXY_PORT} с аутентификацией.`);


  await page.goto('https://driverpracticaltest.dvsa.gov.uk/login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  const initialDelay = Math.random() * 5000 + 2000; // От 2 до 7 секунд
  console.log(`Ожидание случайного времени перед проверкой: ${Math.round(initialDelay / 1000)} секунд...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));

  const captchaData = await page.evaluate(() => {
        const ua = window.navigator.userAgent;
        const targetIframe = document.getElementById("main-iframe");
        
        // Если iframe не найден или его contentWindow недоступен
        if (!targetIframe || !targetIframe.contentWindow) {
            return { "sitekey": null, "siteurl": null, "ua": ua, "status": "no-iframe" };
        }

        const iframeDocument = targetIframe.contentWindow.document;

        // Проверяем, заблокирован ли iframe (наличие класса "error-code")
        const isBlocked = iframeDocument.getElementsByClassName("error-code").length > 0;
        if (isBlocked) {
            return { "sitekey": false, "siteurl": false, "ua": ua, "status": "blocked" };
        }

        const siteurl = iframeDocument.location.href;
        const hcaptchaElements = iframeDocument.getElementsByClassName("h-captcha");

        // Если hCaptcha элементов нет
        if (hcaptchaElements.length === 0) {
            return { "sitekey": null, "siteurl": siteurl, "ua": ua, "status": "no-captcha" };
        }

        // Получаем sitekey из первого hCaptcha элемента
        const sitekey = hcaptchaElements[0].getAttribute("data-sitekey");
        return { "sitekey": sitekey, "siteurl": siteurl, "ua": ua, "status": "ready" };
    });

    console.log('Результат анализа hCaptcha:', captchaData);
// --- НОВЫЙ БЛОК: Добавление случайной задержки и прокрутки после отправки капчи ---
            const postCaptchaDelay = Math.random() * 7000 + 3000; // Задержка от 3 до 10 секунд
            console.log(`Ожидание случайного времени после отправки капчи: ${Math.round(postCaptchaDelay / 1000)} секунд...`);
            await new Promise(resolve => setTimeout(resolve, postCaptchaDelay));

            // Случайная прокрутка страницы
            const scrollAmount = Math.floor(Math.random() * 500) + 100; // Прокрутка на 100-600 пикселей
            console.log(`Выполнение случайной прокрутки страницы на ${scrollAmount} пикселей...`);
            await page.evaluate((amount) => {
                window.scrollBy(0, amount);
            }, scrollAmount);

    // --- Добавленная логика решения капчи ---
    if (captchaData.status === 'ready' && captchaData.sitekey && captchaData.siteurl) {
        console.log('hCaptcha готова к решению. Отправляем на сервис...');
        const solver = new CaptchaSolver(RUCAPTCHA_API_KEY);
        try {
            const hcaptchaToken = await solver.solveHcaptcha(
                captchaData.siteurl,
                captchaData.sitekey,
                captchaData.ua
            );
            console.log('✅ hCaptcha успешно решена! Токен:', hcaptchaToken);
            // --- НОВЫЙ БЛОК: Добавление случайной задержки и прокрутки после отправки капчи ---
            const postCaptchaDelay = Math.random() * 7000 + 3000; // Задержка от 3 до 10 секунд
            console.log(`Ожидание случайного времени после отправки капчи: ${Math.round(postCaptchaDelay / 1000)} секунд...`);
            await new Promise(resolve => setTimeout(resolve, postCaptchaDelay));

            // Случайная прокрутка страницы
            const scrollAmount = Math.floor(Math.random() * 500) + 100; // Прокрутка на 100-600 пикселей
            console.log(`Выполнение случайной прокрутки страницы на ${scrollAmount} пикселей...`);
            await page.evaluate((amount) => {
                window.scrollBy(0, amount);
            }, scrollAmount);
            console.log('Попытка передать токен hCaptcha в iframe...');
            await page.evaluate((token) => {
                const targetIframe = document.getElementById("main-iframe");
                if (targetIframe && targetIframe.contentWindow) {
                    const iframeWindow = targetIframe.contentWindow;
                    // Проверяем, существует ли функция onCaptchaFinished в iframe
                    if (typeof iframeWindow.onCaptchaFinished === 'function') {
                        iframeWindow.onCaptchaFinished(token);
                        console.log('Токен hCaptcha успешно передан в iframe.');
                    } else {
                        console.warn('Функция onCaptchaFinished не найдена в iframe.');
                        // Если onCaptchaFinished не существует, возможно, нужно вставить токен
                        // в скрытое поле h-captcha-response
                        const hCaptchaResponseField = iframeWindow.document.querySelector('[name="h-captcha-response"]');
                        if (hCaptchaResponseField) {
                            hCaptchaResponseField.value = token;
                            console.log('Токен hCaptcha вставлен в скрытое поле.');
                        } else {
                            console.warn('Не удалось найти скрытое поле h-captcha-response в iframe.');
                        }
                    }
                } else {
                    console.error('Iframe с ID "main-iframe" не найден или его contentWindow недоступен.');
                }
            }, hcaptchaToken);

        } catch (error) {
            console.error('❌ Ошибка при решении hCaptcha:', error.name, error.message);
            // Обработка различных типов ошибок
            if (error instanceof CaptchaSolverZeroBalanceException) {
                console.error('Пожалуйста, пополните баланс Rucaptcha.');
            } else if (error instanceof CaptchaSolverWrongKeyException) {
                console.error('Проверьте ваш API ключ Rucaptcha.');
            } else if (error instanceof CaptchaSolverTimeoutException) {
                console.error('Время ожидания решения капчи истекло.');
            }
        }
    } else if (captchaData.status === 'blocked') {
        console.log('❌ Доступ заблокирован Incapsula в iframe. Решение капчи невозможно.');
    } else if (captchaData.status === 'no-iframe') {
        console.log('❌ Iframe с ID "main-iframe" не найден или недоступен.');
    } else if (captchaData.status === 'no-captcha') {
        console.log('❌ hCaptcha не найдена на странице.');
    }
}

async function main() {
  const res = await runPuppeteer();
  console.log('Puppeteer script finished.');
}

main();