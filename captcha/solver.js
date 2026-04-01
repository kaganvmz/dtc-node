import {
  CaptchaSolverException,
  CaptchaSolverZeroBalanceException,
  CaptchaSolverWrongKeyException,
  CaptchaSolverTimeoutException,
} from "./exceptions.js";
import dns from "node:dns/promises";

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
   * @param {object} metadata - { incapsulaScriptBase64, incapsulaSessionCookie, reese84UrlEndpoint? }
   * @param {object} proxy - { type, host, port, username, password }
   * @returns {Promise<object>} Solution with domains and cookies.
   */
  async solve(websiteURL, userAgent, metadata, proxy, options = {}) {
    try {
      const normalizedProxy = await this.#normalizeProxy(proxy);
      const forceLegacy = options.forceLegacy === true;

      if (forceLegacy) {
        console.log("⚠️ Forcing legacy Imperva REST payload...");
        return await this.#solveWithLegacyRest(websiteURL, userAgent, metadata, normalizedProxy);
      }

      try {
        return await this.#solveWithSdk(websiteURL, userAgent, metadata, normalizedProxy);
      } catch (error) {
        const msg = error.message || String(error);
        const shouldFallback =
          msg.includes('CapMonster returned error: "Unknown"') ||
          msg.includes("CapMonster returned error: Unknown") ||
          msg.includes("Unexpected CapMonster solution shape");
        const canUseLegacyFallback = Boolean(metadata.incapsulaScriptUrl && metadata.incapsulaCookies);

        if (!shouldFallback || !canUseLegacyFallback) {
          throw error;
        }

        console.log("⚠️ SDK Imperva flow returned Unknown, retrying with legacy REST payload...");
        return await this.#solveWithLegacyRest(websiteURL, userAgent, metadata, normalizedProxy);
      }

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

  async #solveWithSdk(websiteURL, userAgent, metadata, normalizedProxy) {
    console.log("🛡️ Отправка Imperva задачи в CapMonster...");
    console.log(`📤 websiteURL: ${websiteURL}`);
    console.log(`📤 incapsulaScriptBase64: ${metadata.incapsulaScriptBase64 ? "present" : "missing"}`);
    console.log(`📤 incapsulaSessionCookie: ${metadata.incapsulaSessionCookie?.substring(0, 80) || "missing"}...`);
    console.log(`📤 proxy: ${normalizedProxy.proxyType}://${normalizedProxy.proxyAddress}:${normalizedProxy.proxyPort}`);

    const taskMetadata = {
      incapsulaScriptBase64: metadata.incapsulaScriptBase64,
      incapsulaSessionCookie: metadata.incapsulaSessionCookie,
    };
    if (metadata.reese84UrlEndpoint) {
      taskMetadata.reese84UrlEndpoint = metadata.reese84UrlEndpoint;
    }

    const request = new ImpervaRequest({
      websiteURL,
      userAgent,
      metadata: taskMetadata,
      proxy: normalizedProxy,
    });

    const result = await this.client.Solve(request);

    console.log("✅ CapMonster Imperva решение получено");
    console.log(`📦 Raw SDK result: ${JSON.stringify({
      error: result?.error ?? null,
      hasSolution: Boolean(result?.solution),
      solutionKeys: result?.solution ? Object.keys(result.solution) : []
    })}`);
    const normalizedSolution = this.#normalizeSolution(result);
    const domains = Object.keys(normalizedSolution?.domains || {});
    console.log(`📦 CapMonster domains: ${domains.length > 0 ? domains.join(", ") : "none"}`);
    return normalizedSolution;
  }

  async #solveWithLegacyRest(websiteURL, userAgent, metadata, normalizedProxy) {
    if (!metadata.incapsulaScriptUrl || !metadata.incapsulaCookies) {
      throw new CaptchaSolverException("Legacy Imperva fallback requires incapsulaScriptUrl and incapsulaCookies");
    }

    const task = {
      type: "CustomTask",
      class: "Imperva",
      websiteURL,
      userAgent,
      metadata: {
        incapsulaScriptUrl: metadata.incapsulaScriptUrl,
        incapsulaCookies: metadata.incapsulaCookies,
      },
      proxyType: normalizedProxy.proxyType,
      proxyAddress: normalizedProxy.proxyAddress,
      proxyPort: normalizedProxy.proxyPort,
      proxyLogin: normalizedProxy.proxyLogin,
      proxyPassword: normalizedProxy.proxyPassword,
    };

    if (metadata.reese84UrlEndpoint) {
      task.metadata.reese84UrlEndpoint = metadata.reese84UrlEndpoint;
    }

    console.log(`📤 legacy incapsulaScriptUrl: ${metadata.incapsulaScriptUrl}`);
    console.log(`📤 legacy incapsulaCookies: ${metadata.incapsulaCookies.substring(0, 80)}...`);

    const createResponse = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        clientKey: this.apiKey,
        task
      })
    });

    const createData = await createResponse.json();
    if (!createResponse.ok) {
      throw new CaptchaSolverException(`Legacy createTask failed: HTTP ${createResponse.status}`);
    }

    if (createData.errorId !== 0) {
      throw new CaptchaSolverException(`Legacy createTask error: ${createData.errorCode || createData.errorDescription || "unknown"}`);
    }

    const taskId = createData.taskId;
    console.log(`✅ Legacy CapMonster task created: ${taskId}`);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 120000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const resultResponse = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientKey: this.apiKey,
          taskId
        })
      });

      const resultData = await resultResponse.json();
      if (!resultResponse.ok) {
        throw new CaptchaSolverException(`Legacy getTaskResult failed: HTTP ${resultResponse.status}`);
      }

      if (resultData.errorId !== 0) {
        if (resultData.errorCode === "ERROR_CAPTCHA_NOT_READY") {
          continue;
        }

        throw new CaptchaSolverException(`Legacy getTaskResult error: ${resultData.errorCode || resultData.errorDescription || "unknown"}`);
      }

      if (resultData.status === "processing") {
        continue;
      }

      if (resultData.status === "ready" && resultData.solution) {
        console.log("✅ Legacy CapMonster solution received");
        const domains = Object.keys(resultData.solution?.domains || {});
        console.log(`📦 Legacy CapMonster domains: ${domains.length > 0 ? domains.join(", ") : "none"}`);
        return resultData.solution;
      }
    }

    throw new CaptchaSolverTimeoutException("Legacy CapMonster solve timeout");
  }

  async #normalizeProxy(proxy) {
    let proxyAddress = proxy.host;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(proxy.host) && !proxy.host.includes(":")) {
      try {
        const resolved = await dns.lookup(proxy.host);
        proxyAddress = resolved.address;
      } catch (error) {
        throw new CaptchaSolverException(`Proxy host DNS lookup failed: ${error.message}`);
      }
    }

    return {
      proxyType: proxy.type === "socks5" ? "socks5" : "http",
      proxyAddress,
      proxyPort: proxy.port,
      proxyLogin: proxy.username,
      proxyPassword: proxy.password,
    };
  }

  #normalizeSolution(value) {
    let current = value;
    let guard = 0;

    while (current && guard < 5) {
      if (current.domains && typeof current.domains === "object") {
        return current;
      }

      if (current.error && !current.solution) {
        throw new CaptchaSolverException(`CapMonster returned error: ${JSON.stringify(current.error)}`);
      }

      if (current.solution) {
        current = current.solution;
        guard++;
        continue;
      }

      break;
    }

    throw new CaptchaSolverException(
      `Unexpected CapMonster solution shape: ${JSON.stringify(Object.keys(value || {}))}`
    );
  }
}
