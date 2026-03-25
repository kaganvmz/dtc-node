import fs from 'fs';
import crypto from 'crypto';

/**
 * Custom exception class for proxy file errors.
 */
export class ProxyNoFileException extends Error {
  constructor(message = "Proxy file error") {
    super(message);
    this.name = "ProxyNoFileException";
  }
}

/**
 * Custom exception class for proxy parsing errors.
 */
export class ProxyParseException extends Error {
  constructor(message = "Proxy parse error") {
    super(message);
    this.name = "ProxyParseException";
  }
}

/**
 * Custom exception class for proxy IP change timeout errors.
 */
export class ProxyChangeTimeoutException extends Error {
  constructor(message = "Proxy IP change timeout") {
    super(message);
    this.name = "ProxyChangeTimeoutException";
  }
}

/**
 * A wrapper class for managing proxy configurations and rotations.
 */
export class ProxyManager {
  constructor(maxThreads = 1) {
    this.maxThreads = maxThreads;
    this.currentIndex = 0;
    this.proxyDict = null;
    this.proxyList = [];
    
    // Load proxy configuration
    this.loadProxyConfig();
  }

  /**
   * Loads proxy configuration from proxy.json file.
   * @throws {ProxyNoFileException} If proxy configuration file is missing or invalid.
   */
  loadProxyConfig() {
    try {
      const proxyConfigPath = './proxy.json';
      const configData = fs.readFileSync(proxyConfigPath, 'utf8');
      this.proxyDict = JSON.parse(configData);
      
      // If proxy source is file, load proxy list
      if (this.proxyDict.proxy_source === "file") {
        if (!this.proxyDict.proxy_file) {
          throw new ProxyNoFileException("Please setup proxy_file in proxy.json");
        }
        
        try {
          const proxyFileData = fs.readFileSync(this.proxyDict.proxy_file, 'utf8');
          this.proxyList = proxyFileData.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        } catch (error) {
          throw new ProxyNoFileException("Please setup valid proxy_file in proxy.json");
        }
      }
    } catch (error) {
      if (error instanceof ProxyNoFileException) {
        throw error;
      }
      throw new ProxyNoFileException("Failed to load proxy configuration: " + error.message);
    }
  }

  /**
   * Gets proxy configuration for a specific thread.
   * @param {number} threadId - The thread identifier.
   * @returns {object} Proxy configuration object.
   */
  getProxy(threadId = 1) {
    if (this.proxyDict.proxy_source === "file") {
      return this.getProxyFromFile(threadId);
    } else {
      return this.getProxyFromConfig();
    }
  }

  /**
   * Generates proxy configuration from config template.
   * @returns {object} Generated proxy configuration.
   */
  getProxyFromConfig() {
    const sessionNum = Math.floor(Math.random() * (9999999 - 1111111 + 1)) + 1111111;
    const sessionString = this.getRandomString(8);
    
    const proxyReturn = {
      host: this.proxyDict.host,
      password: this.proxyDict.password,
      port: this.proxyDict.port,
      type: this.proxyDict.type,
      username: this.proxyDict.username
        .replace('{session_string}', sessionString)
        .replace('{session_num}', sessionNum)
    };
    
    return proxyReturn;
  }

  /**
   * Gets proxy from file list with rotation.
   * @param {number} threadId - The thread identifier.
   * @returns {object} Proxy configuration object.
   */
  getProxyFromFile(threadId) {
    if (this.currentIndex === 0) {
      this.currentIndex = threadId;
    } else {
      this.currentIndex = (this.currentIndex + this.maxThreads > this.proxyList.length) 
        ? threadId 
        : this.currentIndex + this.maxThreads;
    }
    
    const proxyString = this.proxyList[this.currentIndex - 1];
    const { proxyReturn, changeIpUrl, proxyClearString } = this.parseProxyLine(proxyString);
    
    // Change IP by URL if configured
    if (this.proxyDict.proxy_change_by_url && changeIpUrl !== "") {
      this.changeIpByUrl(proxyClearString, changeIpUrl);
    }
    
    return proxyReturn;
  }

  /**
   * Changes IP using provided URL endpoint.
   * @param {string} proxyClearString - Clean proxy string for requests.
   * @param {string} changeIpUrl - URL to trigger IP change.
   * @throws {ProxyChangeTimeoutException} If IP change times out.
   */
  async changeIpByUrl(proxyClearString, changeIpUrl) {
    const proxyCheck = {
      http: proxyClearString,
      https: proxyClearString,
    };
    
    // Get initial IP
    let startIp;
    try {
      const response = await fetch("http://ip-api.com/json", {
        // Note: Node.js fetch doesn't support proxy option directly
        // This would need to be implemented with a proper proxy agent
      });
      const data = await response.json();
      startIp = data.query;
    } catch (error) {
      console.warn("Failed to get initial IP:", error.message);
      return;
    }
    
    // Trigger IP change
    try {
      await fetch(changeIpUrl);
    } catch (error) {
      console.warn("Failed to trigger IP change:", error.message);
    }
    
    // Wait for IP to change
    const startTime = Date.now();
    const timeout = 30000; // 30 seconds
    
    while (Date.now() - startTime < timeout) {
      await this.sleep(2000);
      
      try {
        const response = await fetch("http://ip-api.com/json", {
          // Note: Proxy configuration would be needed here
        });
        const data = await response.json();
        const newIp = data.query;
        
        if (newIp !== startIp) {
          console.log(`IP changed from ${startIp} to ${newIp}`);
          return;
        }
      } catch (error) {
        // Continue waiting
      }
    }
    
    throw new ProxyChangeTimeoutException("Timeout waiting for IP change");
  }

  /**
   * Parses proxy line string into components.
   * @param {string} proxyString - Raw proxy string to parse.
   * @returns {object} Object containing parsed proxy, URL, and clear string.
   * @throws {ProxyParseException} If proxy string cannot be parsed.
   */
  parseProxyLine(proxyString) {
    const result = {
      host: "",
      password: "",
      port: 0,
      type: "",
      username: "",
    };
    
    let url = "";
    let proxyClearString = proxyString;
    
    try {
      // Split URL part if exists
      if (proxyString.includes(";")) {
        const [proxyPart, urlPart] = proxyString.split(";", 2);
        proxyClearString = proxyPart;
        url = urlPart;
      }
      
      let remainder = proxyClearString;
      
      // Extract proxy type
      if (proxyClearString.includes("://")) {
        const [proxyType, rest] = proxyClearString.split("://", 2);
        result.type = proxyType;
        remainder = rest;
      }
      
      // Extract credentials if present
      if (remainder.includes("@")) {
        const [creds, address] = remainder.split("@", 2);
        if (creds.includes(":")) {
          const [username, password] = creds.split(":", 2);
          result.username = username;
          result.password = password;
        }
        remainder = address;
      }
      
      // Extract host and port
      if (remainder.includes(":")) {
        const [host, port] = remainder.split(":", 2);
        result.host = host;
        result.port = parseInt(port, 10);
      } else {
        result.host = remainder;
        result.port = 1080; // Default SOCKS port
      }
      
    } catch (error) {
      throw new ProxyParseException("Failed to parse proxy: " + proxyString);
    }
    
    return {
      proxyReturn: result,
      changeIpUrl: url,
      proxyClearString: proxyClearString
    };
  }

  /**
   * Generates random string of specified length.
   * @param {number} length - Length of random string.
   * @returns {string} Random alphanumeric string.
   */
  getRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Gets next proxy in rotation sequence.
   * @param {number} threadId - Thread identifier.
   * @returns {object} Next proxy configuration.
   */
  getNextProxy(threadId = 1) {
    return this.getProxy(threadId);
  }

  /**
   * Resets proxy rotation to beginning.
   */
  resetRotation() {
    this.currentIndex = 0;
  }

  /**
   * Gets current proxy configuration without rotation.
   * @returns {object} Current proxy configuration.
   */
  getCurrentProxy() {
    if (this.proxyDict.proxy_source === "file" && this.proxyList.length > 0) {
      const index = Math.max(0, this.currentIndex - 1);
      const proxyString = this.proxyList[index];
      const { proxyReturn } = this.parseProxyLine(proxyString);
      return proxyReturn;
    } else {
      return this.getProxyFromConfig();
    }
  }

  /**
   * Forces rotation to next proxy in sequence.
   * @param {number} threadId - Thread identifier.
   * @returns {object} New proxy configuration.
   */
  forceRotateProxy(threadId = 1) {
    if (this.proxyDict.proxy_source === "file") {
      // Force move to next proxy in list
      this.currentIndex = (this.currentIndex % this.proxyList.length) + 1;
      return this.getProxyFromFile(threadId);
    } else {
      // Generate new session for config-based proxy
      return this.getProxyFromConfig();
    }
  }

  /**
   * Gets a randomized proxy configuration (new session or random from list).
   * @returns {object} Randomized proxy configuration.
   */
  getRandomizedProxy() {
    if (this.proxyDict.proxy_source === "file") {
      // Get random proxy from list
      const randomIndex = Math.floor(Math.random() * this.proxyList.length);
      const proxyString = this.proxyList[randomIndex];
      const { proxyReturn } = this.parseProxyLine(proxyString);
      return proxyReturn;
    } else {
      // Generate new random session
      return this.getProxyFromConfig();
    }
  }

  /**
   * Validates proxy connectivity.
   * @param {object} proxyConfig - Proxy configuration to test.
   * @returns {Promise<boolean>} True if proxy is working.
   */
  async validateProxy(proxyConfig) {
    try {
      // This would need proper proxy agent implementation
      // For now, just return true as placeholder
      console.log(`Validating proxy: ${proxyConfig.host}:${proxyConfig.port}`);
      return true;
    } catch (error) {
      console.warn(`Proxy validation failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Gets current IP address using proxy.
   * @param {object} proxyConfig - Proxy configuration.
   * @returns {Promise<string>} Current IP address.
   */
  async getCurrentIP(proxyConfig) {
    try {
      // Note: This would need proper proxy implementation
      const response = await fetch("http://ip-api.com/json");
      const data = await response.json();
      return data.query;
    } catch (error) {
      console.warn("Failed to get current IP:", error.message);
      return null;
    }
  }

  /**
   * Formats proxy for Multilogin API format.
   * @param {object} proxyConfig - Standard proxy config.
   * @returns {object} Multilogin-formatted proxy.
   */
  formatForMultilogin(proxyConfig) {
    return {
      host: proxyConfig.host,
      password: proxyConfig.password,
      port: proxyConfig.port,
      type: proxyConfig.type,
      username: proxyConfig.username
    };
  }

  /**
   * Formats proxy as connection string.
   * @param {object} proxyConfig - Proxy configuration.
   * @returns {string} Proxy connection string.
   */
  formatAsString(proxyConfig) {
    if (proxyConfig.username && proxyConfig.password) {
      return `${proxyConfig.type}://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
    } else {
      return `${proxyConfig.type}://${proxyConfig.host}:${proxyConfig.port}`;
    }
  }

  /**
   * Gets proxy statistics.
   * @returns {object} Proxy statistics and configuration info.
   */
  getProxyStats() {
    return {
      source: this.proxyDict.proxy_source,
      totalProxies: this.proxyDict.proxy_source === "file" ? this.proxyList.length : "unlimited",
      currentIndex: this.currentIndex,
      maxThreads: this.maxThreads,
      changeByUrl: this.proxyDict.proxy_change_by_url || false
    };
  }

  /**
   * Sleep utility function.
   * @param {number} ms - Milliseconds to sleep.
   * @returns {Promise} Promise that resolves after specified time.
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}