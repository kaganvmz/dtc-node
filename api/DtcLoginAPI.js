/**
 * API client for Sanctum-protected DTC login endpoints.
 */

export class DtcLoginAPIException extends Error {
  constructor(message = "DTC Login API error", statusCode = null, response = null) {
    super(message);
    this.name = "DtcLoginAPIException";
    this.statusCode = statusCode;
    this.response = response;
  }
}

export class DtcLoginAPIAuthException extends DtcLoginAPIException {
  constructor(message = "DTC Login API authentication error", statusCode = 401, response = null) {
    super(message, statusCode, response);
    this.name = "DtcLoginAPIAuthException";
  }
}

export class DtcLoginAPIResponseException extends DtcLoginAPIException {
  constructor(message = "DTC Login API response error", statusCode = null, response = null) {
    super(message, statusCode, response);
    this.name = "DtcLoginAPIResponseException";
  }
}

export class DtcLoginAPI {
  #apiDomain;
  #requestTimeout = 30000;
  #token = null;
  #headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "DtcLoginAPI-JS/1.0"
  };
  #endpoints = {
    login: "login",
    dtcLogins: "dtc-logins"
  };

  constructor() {
    const apiDomain = process.env.API_DOMAIN;
    const apiUser = process.env.DTC_API_USER;
    const apiSecret = process.env.DTC_API_SECRET;

    if (!apiDomain) {
      throw new DtcLoginAPIException("API_DOMAIN is required");
    }

    if (!apiUser) {
      throw new DtcLoginAPIException("DTC_API_USER is required");
    }

    if (!apiSecret) {
      throw new DtcLoginAPIException("DTC_API_SECRET is required");
    }

    this.apiUser = apiUser;
    this.apiSecret = apiSecret;
    this.#apiDomain = this.#normalizeApiDomain(apiDomain);
    this.#configureLocalTls(this.#apiDomain);

    console.log(`✅ DtcLoginAPI initialized for ${this.#apiDomain}`);
  }

  #normalizeApiDomain(apiDomain) {
    return apiDomain.replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
  }

  #configureLocalTls(apiDomain) {
    try {
      const url = new URL(apiDomain);
      const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".local");

      if (url.protocol === "https:" && isLocalHost && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        console.log("⚠️ NODE_TLS_REJECT_UNAUTHORIZED=0 enabled for local HTTPS API");
      }
    } catch (error) {
      throw new DtcLoginAPIException(`Invalid API_DOMAIN: ${error.message}`);
    }
  }

  #buildUrl(endpoint) {
    return `${this.#apiDomain}/${endpoint.replace(/^\/+/, "")}/`;
  }

  #validateId(id) {
    if (id === undefined || id === null || id === "") {
      throw new DtcLoginAPIException("DTC login id is required");
    }
  }

  #validateCredentialsPayload(payload, allowError = false) {
    if (!payload || typeof payload !== "object") {
      throw new DtcLoginAPIException("Payload with licence_number and theory_test_ref is required");
    }

    if (!payload.licence_number) {
      throw new DtcLoginAPIException("licence_number is required");
    }

    if (!payload.theory_test_ref) {
      throw new DtcLoginAPIException("theory_test_ref is required");
    }

    if (!allowError && Object.prototype.hasOwnProperty.call(payload, "error")) {
      throw new DtcLoginAPIException("error field is not allowed for this request");
    }
  }

  async #makeRequest(method, endpoint, options = {}) {
    const { data, requiresAuth = false } = options;
    const requestHeaders = { ...this.#headers };

    if (requiresAuth) {
      if (!this.#token) {
        throw new DtcLoginAPIAuthException("Bearer token is missing. Call login() first.");
      }

      requestHeaders.Authorization = `Bearer ${this.#token}`;
    }

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: requestHeaders
    };

    if (data !== undefined) {
      fetchOptions.body = JSON.stringify(data);
    }

    const url = this.#buildUrl(endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#requestTimeout);
    fetchOptions.signal = controller.signal;

    try {
      console.log(`🌐 ${fetchOptions.method} ${url}`);
      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();
      const parsedBody = this.#parseJson(responseText, response.status);

      if (!response.ok) {
        this.#throwHttpError(response.status, response.statusText, parsedBody);
      }

      return parsedBody;
    } catch (error) {
      if (error instanceof DtcLoginAPIException) {
        throw error;
      }

      if (error.name === "AbortError") {
        throw new DtcLoginAPIException(`Request timeout after ${this.#requestTimeout}ms`);
      }

      throw new DtcLoginAPIException(`Request failed: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  #parseJson(responseText, statusCode) {
    if (!responseText) {
      return null;
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      throw new DtcLoginAPIResponseException(
        `Invalid JSON response received (HTTP ${statusCode})`,
        statusCode,
        responseText
      );
    }
  }

  #throwHttpError(statusCode, statusText, responseBody) {
    const message = responseBody?.message || `HTTP ${statusCode}: ${statusText}`;

    if (statusCode === 401 || statusCode === 403) {
      throw new DtcLoginAPIAuthException(`Authentication failed: ${message}`, statusCode, responseBody);
    }

    throw new DtcLoginAPIException(message, statusCode, responseBody);
  }

  async login() {
    console.log("🔐 Requesting Sanctum token...");

    const response = await this.#makeRequest("POST", this.#endpoints.login, {
      data: {
        user: this.apiUser,
        secret: this.apiSecret
      }
    });

    if (!response?.token || typeof response.token !== "string") {
      throw new DtcLoginAPIResponseException("Login response does not contain a valid token", 200, response);
    }

    this.#token = response.token;
    console.log("✅ Sanctum token received");

    return this.#token;
  }

  async getDtcLogins() {
    console.log("📋 Requesting DTC logins...");

    const response = await this.#makeRequest("GET", this.#endpoints.dtcLogins, {
      requiresAuth: true
    });

    if (!Array.isArray(response)) {
      throw new DtcLoginAPIResponseException("Expected /dtc-logins to return an array", 200, response);
    }

    console.log(`✅ Retrieved ${response.length} DTC login record(s)`);
    return response;
  }

  async getDtcLogin(id) {
    this.#validateId(id);
    console.log(`📄 Requesting DTC login ${id}...`);

    const response = await this.#makeRequest("GET", `dtc-login/${id}`, {
      requiresAuth: true
    });

    if (!Array.isArray(response)) {
      throw new DtcLoginAPIResponseException("Expected /dtc-login/{id} to return an array", 200, response);
    }

    return response;
  }

  async takeDtcLogin(id) {
    this.#validateId(id);
    console.log(`🛠️ Taking DTC login ${id}...`);

    return this.#makeRequest("PATCH", `dtc-login/${id}/take`, {
      requiresAuth: true
    });
  }

  async approveDtcLogin(id, payload) {
    this.#validateId(id);
    this.#validateCredentialsPayload(payload);
    console.log(`✅ Approving DTC login ${id}...`);

    return this.#makeRequest("PATCH", `dtc-login/${id}/approve`, {
      requiresAuth: true,
      data: {
        licence_number: payload.licence_number,
        theory_test_ref: payload.theory_test_ref
      }
    });
  }

  async failDtcLogin(id, payload) {
    this.#validateId(id);
    this.#validateCredentialsPayload(payload, true);
    console.log(`❌ Marking DTC login ${id} as failed...`);

    const data = {
      licence_number: payload.licence_number,
      theory_test_ref: payload.theory_test_ref
    };

    if (payload.error !== undefined) {
      data.error = payload.error;
    }

    return this.#makeRequest("PATCH", `dtc-login/${id}/approve/fail`, {
      requiresAuth: true,
      data
    });
  }
}

export { DtcLoginAPI as ApiClient };
