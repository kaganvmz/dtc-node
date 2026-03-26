/**
 * API client for driving test cancellation tasks
 * JavaScript port of Python TasksApi class
 */

/**
 * Custom exception class for Tasks API errors.
 */
export class TasksAPIException extends Error {
  constructor(message = "Tasks API error", statusCode = null, response = null) {
    super(message);
    this.name = "TasksAPIException";
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Custom exception class for API authentication errors.
 */
export class TasksAPIAuthException extends TasksAPIException {
  constructor(message = "API authentication error") {
    super(message);
    this.name = "TasksAPIAuthException";
  }
}

/**
 * Custom exception class for API rate limiting errors.
 */
export class TasksAPIRateLimitException extends TasksAPIException {
  constructor(message = "API rate limit exceeded") {
    super(message);
    this.name = "TasksAPIRateLimitException";
  }
}

/**
 * A wrapper class for the Tasks API client.
 */
export class TasksAPI {
  // Private API configuration
  #apiDomain = process.env.API_DOMAIN;
  #endpoints = {
    getTask: "get-task",
    // ping: "ping",
    cancel: "cancel-task",
    success: "success-task"
  };
  #headers = {};
  #requestTimeout = 30000; // 30 seconds

  /**
   * @param {string} apiToken - API authentication token
   * @param {string} workerName - Name of the worker/bot instance
   */
  constructor(apiToken, workerName) {
    if (!apiToken || !workerName) {
      throw new TasksAPIException("API token and worker name are required");
    }

    this.apiToken = apiToken;
    this.workerName = workerName;

    // Set up HTTP headers
    this.#headers = {
      "Content-Type": "application/json",
      "X-API-Token": this.apiToken,
      "worker-name": this.workerName,
      "User-Agent": `TasksAPI-JS/1.0 (Worker: ${this.workerName})`
    };

    console.log(`✅ TasksAPI initialized for worker: ${this.workerName}`);
  }

  /**
   * Makes HTTP request with error handling and retries
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options (params, data, etc.)
   * @returns {Promise<object>} API response
   */
  async #makeRequest(method, endpoint, options = {}) {
    // skip SSL verification for localhost
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const url = `${this.#apiDomain}${endpoint}/`;
    const { params, data } = options;

    // Build URL with query parameters
    let requestUrl = url;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) {
          searchParams.append(key, value.toString());
        }
      }
      requestUrl += `?${searchParams.toString()}`;
    }

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: this.#headers,
      timeout: this.#requestTimeout
    };

    // Add body for POST requests
    if (data && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
      fetchOptions.body = JSON.stringify(data);
    }

    try {
      console.log(`🌐 ${method.toUpperCase()} ${requestUrl}`);

      const response = await fetch(requestUrl, fetchOptions);

      // Handle HTTP errors
      if (!response.ok) {
        await this.#handleHttpError(response);
      }

      const responseData = await response.json();
      console.log(`✅ API Response: ${response.status}`);

      return responseData;

    } catch (error) {
      if (error instanceof TasksAPIException) {
        throw error;
      }

      console.error(`❌ Request failed: ${error.message}`);
      throw new TasksAPIException(`Request failed: ${error.message}`);
    }
  }

  /**
   * Handle HTTP error responses
   * @param {Response} response - Fetch response object
   */
  async #handleHttpError(response) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch (e) {
      // Ignore JSON parsing errors for error responses
    }

    switch (response.status) {
      case 401:
      case 403:
        throw new TasksAPIAuthException(`Authentication failed: ${errorMessage}`);
      case 429:
        throw new TasksAPIRateLimitException(`Rate limit exceeded: ${errorMessage}`);
      case 404:
        throw new TasksAPIException(`Endpoint not found: ${errorMessage}`, response.status);
      case 500:
      case 502:
      case 503:
        throw new TasksAPIException(`Server error: ${errorMessage}`, response.status);
      default:
        throw new TasksAPIException(errorMessage, response.status);
    }
  }

  /**
   * Get next available task from the API
   * @returns {Promise<object|null>} Task object or null if no tasks available
   */
  async getTask() {
    console.log("📋 Requesting next task from API...");

    try {
      const response = await this.#makeRequest('GET', this.#endpoints.getTask);

      if (!response || response.error) {
        console.log("⭕ No tasks available");
        return null;
      }

      // Validate task structure
      if (!this.#isValidTask(response)) {
        throw new TasksAPIException("Invalid task structure received from API");
      }

      console.log(`✅ Task received: ID=${response.id}, License=${response.license}, Status=${response.status}`);
      return response;

    } catch (error) {
      console.error(`❌ Failed to get task: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cancel a task with optional error flags
   * @param {number} taskId - Task ID to cancel
   * @param {object} options - Cancel options
   * @param {boolean} options.isLimit - Whether cancellation due to rate limit
   * @param {boolean} options.isAuthError - Whether cancellation due to auth error
   * @returns {Promise<object>} API response
   */
  async cancelTask(taskId, options = {}) {
    const { isLimit = false, isAuthError = false, error = '' } = options;

    console.log(`🚫 Cancelling task ${taskId}... (limit: ${isLimit}, auth_error: ${isAuthError})`);

    const data = {
      id: taskId,
      is_limit: isLimit,
      is_auth_error: isAuthError,
      error: error,
    };

    try {
      const response = await this.#makeRequest('POST', `${this.#endpoints.cancel}/${taskId}`, { data });
      console.log(`✅ Task ${taskId} cancelled successfully`);
      return response;

    } catch (error) {
      console.error(`❌ Failed to cancel task ${taskId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark task as successfully completed
   * @param {number} taskId - Task ID to mark as success
   * @param {string} date - Found available date
   * @param {string} testCenter - Test center name
   * @returns {Promise<object>} API response
   */
  async successTask(taskId, date, testCenter) {
    console.log(`🎉 Marking task ${taskId} as success: ${date} at ${testCenter}`);

    const data = {
      id: taskId,
      date: date,
      test_center: testCenter
    };

    try {
      const response = await this.#makeRequest('POST', `${this.#endpoints.success}/${taskId}`, { data });
      console.log(`✅ Task ${taskId} marked as successful`);
      return response;

    } catch (error) {
      console.error(`❌ Failed to mark task ${taskId} as success: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send ping to keep task active
   * @param {number} taskId - Task ID to ping
   * @returns {Promise<object>} API response
   */
  // async ping(taskId) {
  //   console.log(`💗 Pinging task ${taskId}...`);

  //   const params = { id: taskId };

  //   try {
  //     const response = await this.#makeRequest('GET', this.#endpoints.ping, { params });
  //     console.log(`✅ Task ${taskId} pinged successfully`);
  //     return response;

  //   } catch (error) {
  //     console.warn(`⚠️ Failed to ping task ${taskId}: ${error.message}`);
  //     // Don't throw for ping failures, just log warning
  //     return null;
  //   }
  // }

  /**
   * Validate task object structure
   * @param {object} task - Task object to validate
   * @returns {boolean} True if task is valid
   */
  #isValidTask(task) {
    const requiredFields = ['id', 'license', 'ref_num', 'status'];

    for (const field of requiredFields) {
      if (!task.hasOwnProperty(field) || task[field] === null || task[field] === undefined) {
        console.warn(`⚠️ Task validation failed: missing field '${field}'`);
        return false;
      }
    }

    return true;
  }

  /**
   * Convert API task to login data format
   * @param {object} task - Task object from API
   * @returns {object} Login data object
   */
  convertTaskToLoginData(task) {
    if (!task) return null;

    return {
      taskId: task.id,
      username: task.license,
      password: task.ref_num,
      profileName: `TASK_${task.id}_${task.license}`,
      testCenters: task.test_centers || [],
      datesRange: task.dates_range || [],
      attempts: 0,
      status: 'pending',
      apiTask: task // Keep original task data
    };
  }

  /**
   * Get API statistics
   * @returns {object} API stats
   */
  getStats() {
    return {
      apiDomain: this.#apiDomain,
      workerName: this.workerName,
      endpoints: Object.keys(this.#endpoints),
      requestTimeout: this.#requestTimeout
    };
  }
}