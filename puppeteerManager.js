// src/puppeteerManager.js - Управление браузером Puppeteer

// import { getRandomUserAgent } from "./utils/userAgent.js";
import { PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD } from "./config.js";

/**
 * Настраивает страницу Puppeteer, устанавливая User-Agent, Viewport и прокси.
 * @param {import('puppeteer').Page} page - Объект страницы Puppeteer.
 */
export async function setupPage(page) {
    // const userAgent = getRandomUserAgent();
    // await page.setUserAgent(userAgent);
    
    const width = 1024 + Math.floor(Math.random() * 500);
    const height = 768 + Math.floor(Math.random() * 300);
    await page.setViewport({ width, height });

    console.log(`Используется прокси: ${PROXY_HOST}:${PROXY_PORT} с аутентификацией.`);
    await page.authenticate({
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD
    });
}

/**
 * Анализирует страницу на наличие iframe с hCaptcha.
 * @param {import('puppeteer').Page} page - Объект страницы Puppeteer.
 * @returns {Promise<{sitekey: string|null, siteurl: string|null, ua: string, status: string}>}
 */
export async function analyzeCaptchaIframe(page) {
    return await page.evaluate(() => {
        const ua = window.navigator.userAgent;
        const targetIframe = document.getElementById("main-iframe");
        
        if (!targetIframe || !targetIframe.contentWindow) {
            return { "sitekey": null, "siteurl": null, "ua": ua, "status": "no-iframe" };
        }

        const iframeDocument = targetIframe.contentWindow.document;
        const isBlocked = iframeDocument.getElementsByClassName("error-code").length > 0;
        if (isBlocked) {
            return { "sitekey": null, "siteurl": null, "ua": ua, "status": "blocked" };
        }

        const siteurl = iframeDocument.location.href;
        const hcaptchaElements = iframeDocument.getElementsByClassName("h-captcha");

        if (hcaptchaElements.length === 0) {
            return { "sitekey": null, "siteurl": siteurl, "ua": ua, "status": "no-captcha" };
        }

        const sitekey = hcaptchaElements[0].getAttribute("data-sitekey");
        return { "sitekey": sitekey, "siteurl": siteurl, "ua": ua, "status": "ready" };
    });
}

/**
 * Передает hCaptcha токен в iframe.
 * @param {import('puppeteer').Page} page - Объект страницы Puppeteer.
 * @param {string} token - Токен hCaptcha.
 */
export async function injectCaptchaToken(page, token) {
    console.log('Попытка передать токен hCaptcha в iframe...');
    await page.evaluate((token) => {
        const targetIframe = document.getElementById("main-iframe");
        if (targetIframe && targetIframe.contentWindow) {
            const iframeWindow = targetIframe.contentWindow;
            if (typeof iframeWindow.onCaptchaFinished === 'function') {
                iframeWindow.onCaptchaFinished(token);
                console.log('Токен hCaptcha успешно передан в iframe.');
            } else {
                console.warn('Функция onCaptchaFinished не найдена в iframe.');
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
    }, token);
}