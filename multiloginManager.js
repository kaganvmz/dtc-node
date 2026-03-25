// src/multiloginManager.js - Управление профилями Multilogin

import puppeteerExtra from "puppeteer-extra";
import { MultiloginAPI } from "./multilogin/multilogin.js";
import { MULTILOGIN_EMAIL, MULTILOGIN_PASSWORD } from "./config.js";


/**
 * Подключается к Multilogin API и запускает профиль,
 * затем подключает Puppeteer к этому профилю.
 * @param {string} multiloginEmail - Email для Multilogin API.
 * @param {string} multiloginPassword - Пароль для Multilogin API.
 * @param {string} profileId - ID профиля Multilogin для запуска.
 * @returns {Promise<{browser: import('puppeteer').Browser, page: import('puppeteer').Page, mla: MultiloginAPI}>}
 */
export async function connectAndStartMultiloginProfile(multiloginEmail, multiloginPassword, profileId) {
    const mla = new MultiloginAPI(multiloginEmail, multiloginPassword);
    
    // Авторизуемся один раз в начале
    await mla.apiInit();
    console.log("✅ Успешно авторизован в Multilogin API.");
    
    console.log(`Запуск профиля Multilogin с ID: ${profileId}`);
    const startResult = await mla.startProfile(profileId);
    console.log(startResult);

    if (startResult.status.http_code !== 200 && startResult.status.error_code === 'GET_PROXY_CONNECTION_IP_ERROR') {
        const updateResult =  await mla.updateProfileProxy(profileId, 'gate.multilogin.com:1080:2235440328_ab94f23e_bbdc_41c6-b3a5-146189889db5_multilogin_com-country-gb-region-england-sid-BvpafzV7-filter-medium:x0sxun0ssc');
        console.log("✅ Профиль успешно обновлён с новым прокси:", updateResult);
    }
    
    if (!startResult.data || !startResult.data.port) {
        throw new Error("Не удалось получить порт для подключения от Multilogin.");
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
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    if (!wsEndpoint) {
        throw new Error("Не удалось получить webSocketDebuggerUrl из Multilogin после нескольких попыток.");
    }
    console.log(`✅ Профиль Multilogin запущен. WebSocket Endpoint: ${wsEndpoint}`);

    const browser = await puppeteerExtra.connect({
        browserWSEndpoint: wsEndpoint
    });
    
    const page = await browser.newPage();

    return { browser, page, mla };
}
