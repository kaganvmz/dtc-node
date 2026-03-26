import crypto from "crypto";
import { ProxyManager } from "../proxy/ProxyManager.js";
// import fetch from "node-fetch"; // В Node.js v18+ fetch доступен глобально

/**
 * Custom exception class for Multilogin API errors.
 */
export class MultiloginException extends Error {
  constructor(message = "Multilogin API error") {
    super(message);
    this.name = "MultiloginException";
  }
}

/**
 * A wrapper class for the Multilogin API.
 */
export class MultiloginAPI {
  #apiServer = "https://api.multilogin.com";
  #launcherServer = "https://launcher.mlx.yt:45001/api";
  #signinEndpoint = "/user/signin";
  #searchEndpoint = "/profile/search";
  #createEndpoint = "/profile/create";
  #removeEndpoint = "/profile/remove";
  #updateEndpoint = "/profile/partial_update";
  #unlockEndpoint = "/bpds/profile/unlock_profiles";
  #token = null;
  #httpHeaders = {};

  /**
   * @param {string} username - Multilogin account email.
   * @param {string} password - Multilogin account password.
   */
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.defaultFolder = "ab94f23e-bbdc-41c6-b3a5-146189889db5";
    this.defaultCoreVersion = Number(process.env.MULTILOGIN_CORE_VERSION || 146);
    this.proxyManager = new ProxyManager(1);
    this.currentProxyConfig = null;
    this.browserProfileName = process.env.BROWSER_PROFILE_NAME || null;
  }

  /**
   * Initializes the API by signing in and getting an access token.
   * @throws {MultiloginException} If login fails.
   */
  async apiInit() {
    console.log("Attempting to sign in to Multilogin API...");

    // Using Node.js built-in crypto module for MD5 hashing
    const hashedPassword = crypto.createHash('md5').update(this.password).digest('hex');

    const payload = {
      email: this.username,
      password: hashedPassword,
    };

    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      try {
        const res = await fetch(`${this.#apiServer}${this.#signinEndpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 200) {
          const result = await res.json();
          this.#token = result.data.token;
          this.#httpHeaders = { "Authorization": `Bearer ${this.#token}` };
          console.log("✅ Successfully signed in to Multilogin API.");
          break;
        } else if (res.status === 429) {
          console.warn(`Rate limit hit (429). Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          attempts++;
        } else {
          const errorText = await res.text();
          throw new MultiloginException(`Error during login: ${errorText}`);
        }
      } catch (error) {
        if (error.name === "MultiloginException") {
          throw error;
        }
        console.error(`Error during fetch: ${error.message}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }
    }
  }

  /**
   * A helper function to wrap requests and handle token expiration.
   * @param {Function} requestFunction - The function to execute.
   * @returns {Promise<any>} The response JSON.
   */
  async #makeRequest(requestFunction) {
    while (true) {
      try {
        const response = await requestFunction();
        const jsonResponse = await response.json();
        console.log("Response received:", jsonResponse);
        // Check for token expiration in the response body
        const errorCode = jsonResponse?.status?.error_code;
        if (errorCode === "EXPIRED_JWT_TOKEN" || errorCode === "UNAUTHORIZED_REQUEST") {
          console.warn("API token expired or unauthorized. Re-initializing...", this.#token, this.#httpHeaders);
          await this.apiInit();
          continue; // Retry the request with the new token
        }

        return jsonResponse;
      } catch (error) {
        // Handle network or other errors here
        throw new MultiloginException(error.message);
      }
    }
  }

  /**
   * Searches for a profile by name.
   * @param {string} profileName - The name of the profile to search for.
   * @returns {Promise<object>} The search results.
   */
  async searchProfile(profileName) {
    const data = {
      offset: 0,
      limit: 100,
      search_text: profileName,
    };
    return this.#makeRequest(() =>
      fetch(`${this.#apiServer}${this.#searchEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.#httpHeaders },
        body: JSON.stringify(data),
      })
    );
  }

  /**
   * Creates a new browser profile.
   * @param {string} profileName - The name for the new profile.
   * @param {object} proxy - The proxy configuration object.
   * @param {string} browserType - The browser type (e.g., "stealthfox", "mimic").
   * @returns {Promise<object>} The creation result.
   */
  async createProfile(profileName, proxy, browserType) {
    const data = {
      name: profileName,
      browser_type: browserType,
      folder_id: this.defaultFolder,
      core_version: this.defaultCoreVersion,
      os_type: "windows",
      proxy: proxy,
      parameters: {
        flags: {
          audio_masking: "mask",
          fonts_masking: "mask",
          geolocation_masking: "mask",
          geolocation_popup: "block",
          graphics_masking: "mask",
          graphics_noise: "mask",
          localization_masking: "mask",
          media_devices_masking: "mask",
          navigator_masking: "mask",
          ports_masking: "mask",
          proxy_masking: "custom",
          screen_masking: "mask",
          timezone_masking: "mask",
          webrtc_masking: "mask",
          canvas_noise: "mask",
        },
        storage: { is_local: false, save_service_worker: true },
        fingerprint: {},
      },
    };
    const res = await fetch(`${this.#apiServer}${this.#createEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", ...this.#httpHeaders },
      body: JSON.stringify(data),
    });
    const bodyText = await res.text();
    try {
      return JSON.parse(bodyText);
    } catch (error) {
      const preview = bodyText.replace(/\s+/g, " ").trim().slice(0, 220);
      throw new MultiloginException(
        `Create profile failed: HTTP ${res.status} ${res.statusText}. Body preview: ${preview}`
      );
    }
  }

  /**
   * Removes a profile.
   * @param {string} profileId - The ID of the profile to remove.
   * @param {boolean} [permanently=false] - Whether to remove the profile permanently.
   * @returns {Promise<object>} The removal result.
   */
  async removeProfile(profileId, permanently = false) {
    const data = {
      ids: [profileId],
      permanently: permanently,
    };
    const res = await fetch(`${this.#apiServer}${this.#removeEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#httpHeaders },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  /**
   * Starts a profile.
   * @param {string} profileId - The ID of the profile to start.
   * @param {string} [folderId=null] - The folder ID. Uses default if null.
   * @param {boolean} [headlessMode=false] - Whether to run in headless mode.
   * @returns {Promise<object>} The result of starting the profile.
   */
  async startProfile(profileId, folderId = null, headlessMode = false) {
    const params = new URLSearchParams({
      automation_type: "playwright",
      headless_mode: headlessMode,
    });
    const finalFolderId = folderId || this.defaultFolder;

    return this.#makeRequest(() =>
      fetch(`${this.#launcherServer}/v2/profile/f/${finalFolderId}/p/${profileId}/start?${params.toString()}`, {
        method: "GET",
        headers: this.#httpHeaders,
      })
    );
  }

  /**
   * Unlocks a list of profiles.
   * @param {string[]} profilesList - An array of profile IDs to unlock.
   * @returns {Promise<object>} The unlock result.
   */
  async unlockProfiles(profilesList) {
    const data = {
      ids: profilesList,
    };
    const res = await fetch(`${this.#apiServer}${this.#unlockEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#httpHeaders },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  /**
   * Updates the proxy for a specific profile.
   * @param {string} profileId - The ID of the profile to update.
   * @param {object} proxy - The new proxy configuration.
   * @returns {Promise<object>} The update result.
   */
  async updateProfileProxy(profileId, proxy) {
    const data = {
      profile_id: profileId,
      proxy: proxy,
    };
    const res = await fetch(`${this.#apiServer}${this.#updateEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#httpHeaders },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  /**
   * Stops a profile.
   * @param {string} profileId - The ID of the profile to stop.
   * @returns {Promise<object>} The stop result.
   */
  async stopProfile(profileId) {
    return this.#makeRequest(() =>
      fetch(`${this.#launcherServer}/v1/profile/stop/p/${profileId}`, {
        method: "GET",
        headers: this.#httpHeaders,
      })
    );
  }
  /**
   * Finds a profile ID by its name from the search results.
   * @param {object} searchResult - The result object from the searchProfile method.
   * @param {string} profileName - The name of the profile to find.
   * @returns {string|null} The profile ID if found, otherwise null.
   */
  findProfileIdByName(searchResult, profileName) {
    if (!searchResult?.data?.profiles || !Array.isArray(searchResult.data.profiles)) {
      return null;
    }

    const profile = searchResult.data.profiles.find(profile =>
      profile && profile.name === profileName
    );

    return profile ? profile.id : null;
  }

  /**
   * Gets current proxy configuration from proxy manager.
   * @param {number} threadId - Thread identifier for proxy rotation.
   * @returns {object} Current proxy configuration.
   */
  getCurrentProxy(threadId = 1) {
    if (!this.currentProxyConfig) {
      this.currentProxyConfig = this.proxyManager.getProxy(threadId);
    }
    return this.currentProxyConfig;
  }

  /**
   * Rotates to next proxy in sequence.
   * @param {number} threadId - Thread identifier.
   * @returns {object} New proxy configuration.
   */
  rotateProxy(threadId = 1) {
    console.log("🔄 Rotating proxy...");
    this.currentProxyConfig = this.proxyManager.forceRotateProxy(threadId);
    console.log(`✅ New proxy: ${this.currentProxyConfig.host}:${this.currentProxyConfig.port}`);
    return this.currentProxyConfig;
  }

  /**
   * Gets a completely randomized proxy configuration.
   * @returns {object} Randomized proxy configuration.
   */
  getRandomizedProxy() {
    console.log("🎲 Getting randomized proxy...");
    this.currentProxyConfig = this.proxyManager.getRandomizedProxy();
    console.log(`✅ Random proxy: ${this.currentProxyConfig.host}:${this.currentProxyConfig.port}`);
    return this.currentProxyConfig;
  }

  /**
   * Updates profile with new proxy and handles rotation on failure.
   * @param {string} profileId - The ID of the profile to update.
   * @param {object} [proxyConfig=null] - Custom proxy config, uses current if null.
   * @param {number} [maxRetries=3] - Maximum retry attempts.
   * @returns {Promise<object>} The update result.
   */
  async updateProfileProxyWithRotation(profileId, proxyConfig = null, maxRetries = 3) {
    let currentProxy = proxyConfig || this.getCurrentProxy();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔧 Updating profile proxy (attempt ${attempt}/${maxRetries})...`);

        // Format proxy for Multilogin
        const formattedProxy = this.proxyManager.formatForMultilogin(currentProxy);
        const result = await this.updateProfileProxy(profileId, formattedProxy);

        if (result.status?.http_code === 200 || result.status?.http_code === 201) {
          console.log("✅ Profile proxy updated successfully");
          this.currentProxyConfig = currentProxy;
          return result;
        } else {
          throw new Error(`Proxy update failed: ${result.status?.message || 'Unknown error'}`);
        }

      } catch (error) {
        console.warn(`❌ Proxy update attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // Rotate to next proxy for retry
          currentProxy = this.rotateProxy();
          await this.sleep(2000); // Brief pause between attempts
        } else {
          throw new MultiloginException(`Failed to update proxy after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
  }

  /**
   * Starts profile with automatic proxy handling and rotation on failure.
   * @param {string} profileId - The ID of the profile to start.
   * @param {string} [folderId=null] - The folder ID.
   * @param {boolean} [headlessMode=false] - Whether to run in headless mode.
   * @param {number} [maxRetries=3] - Maximum retry attempts.
   * @returns {Promise<object>} The result of starting the profile.
   */
  async startProfileWithProxyRotation(profileId, folderId = null, headlessMode = false, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🚀 Starting profile with proxy rotation (attempt ${attempt}/${maxRetries})...`);

        const result = await this.startProfile(profileId, folderId, headlessMode);

        // Check for proxy-related errors
        if (result.status?.error_code === 'GET_PROXY_CONNECTION_IP_ERROR') {
          throw new Error('Proxy connection error');
        }

        if (result.status?.http_code === 200) {
          console.log("✅ Profile started successfully with current proxy");
          return result;
        } else {
          throw new Error(`Profile start failed: ${result.status?.message || 'Unknown error'}`);
        }

      } catch (error) {
        console.warn(`❌ Profile start attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // Rotate proxy and update profile
          const newProxy = this.rotateProxy();
          await this.updateProfileProxyWithRotation(profileId, newProxy, 1);
          await this.sleep(3000); // Pause before retry
        } else {
          throw new MultiloginException(`Failed to start profile after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
  }

  /**
   * Gets proxy statistics and current status.
   * @returns {object} Proxy statistics.
   */
  getProxyStats() {
    return {
      ...this.proxyManager.getProxyStats(),
      currentProxy: this.currentProxyConfig
    };
  }

  /**
   * Sleep utility function.
   * @param {number} ms - Milliseconds to sleep.
   * @returns {Promise} Promise that resolves after specified time.
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
