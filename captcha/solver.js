import {
  CaptchaSolverException,
  CaptchaSolverZeroBalanceException,
  CaptchaSolverWrongKeyException,
  CaptchaSolverTimeoutException,
} from "./exceptions.js";

import pkg from '@zennolab_com/capmonstercloud-client';
const { CapMonsterCloudClientFactory, ClientOptions, ImpervaRequest } = pkg;

/**
 * Imperva/Incapsula bypass solver using CapMonster Cloud SDK.
 * Replaces the old CaptchaSolver (RuCaptcha hCaptcha).
 */
export class ImpervaBypassSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = CapMonsterCloudClientFactory.Create(
      new ClientOptions({ clientKey: apiKey })
    );
  }

  /**
   * Check CapMonster balance.
   * @returns {Promise<number>} Balance in USD.
   */
  async getBalance() {
    try {
      const balance = await this.client.getBalance();
      return balance;
    } catch (error) {
      throw new CaptchaSolverException(`Balance check failed: ${error.message}`);
    }
  }

  /**
   * Solve Imperva/Incapsula protection.
   * @param {string} websiteURL - Target page URL.
   * @param {string} userAgent - Browser user agent (Windows only).
   * @param {object} metadata - { incapsulaScriptUrl, incapsulaCookies, reese84UrlEndpoint? }
   * @param {object} proxy - { type, host, port, username, password }
   * @returns {Promise<object>} Solution with domains and cookies.
   */
  async solve(websiteURL, userAgent, metadata, proxy) {
    try {
      console.log("🛡️ Отправка Imperva задачи в CapMonster...");
      console.log(`📤 websiteURL: ${websiteURL}`);
      console.log(`📤 incapsulaScriptUrl: ${metadata.incapsulaScriptUrl}`);
      console.log(`📤 incapsulaCookies: ${metadata.incapsulaCookies?.substring(0, 80)}...`);
      console.log(`📤 proxy: ${proxy.type}://${proxy.host}:${proxy.port}`);

      const taskMetadata = {
        incapsulaScriptUrl: metadata.incapsulaScriptUrl,
        incapsulaCookies: metadata.incapsulaCookies,
      };
      if (metadata.reese84UrlEndpoint) {
        taskMetadata.reese84UrlEndpoint = metadata.reese84UrlEndpoint;
      }

      const request = new ImpervaRequest({
        websiteURL,
        userAgent,
        metadata: taskMetadata,
        proxy: {
          proxyType: proxy.type === "socks5" ? "socks5" : "http",
          proxyAddress: proxy.host,
          proxyPort: proxy.port,
          proxyLogin: proxy.username,
          proxyPassword: proxy.password,
        },
      });

      const result = await this.client.Solve(request);

      console.log("✅ CapMonster Imperva решение получено");
      console.log("📦 Полный результат SDK:", JSON.stringify(result, null, 2));

      // SDK возвращает CaptchaResult { solution: ... }
      // solution может быть на верхнем уровне или внутри .solution
      const solution = result?.solution || result;

      if (!solution || (typeof solution === 'object' && Object.keys(solution).length === 0)) {
        throw new CaptchaSolverException("Empty solution from CapMonster");
      }

      // Если solution содержит domains — это правильный ответ Imperva
      // Если solution сам по себе содержит cookies — тоже ок
      return solution;

    } catch (error) {
      if (error instanceof CaptchaSolverException) {
        throw error;
      }

      const msg = error.message || String(error);

      if (msg.includes("ERROR_KEY_DOES_NOT_EXIST")) {
        throw new CaptchaSolverWrongKeyException("Invalid CapMonster API key");
      }
      if (msg.includes("ERROR_ZERO_BALANCE")) {
        throw new CaptchaSolverZeroBalanceException("CapMonster balance is zero");
      }
      if (msg.includes("TIMEOUT") || msg.includes("timeout")) {
        throw new CaptchaSolverTimeoutException("CapMonster solve timeout");
      }

      throw new CaptchaSolverException(`Imperva bypass failed: ${msg}`);
    }
  }
}
