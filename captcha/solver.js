import {
  CaptchaSolverException,
  CaptchaSolverZeroBalanceException,
  CaptchaSolverWrongKeyException,
  CaptchaSolverTimeoutException,
} from "./exceptions.js";
// --- CaptchaSolver Class (Перевод из Python) ---
export class CaptchaSolver {
  static #apiServer = "https://rucaptcha.com/";
  static #endpointCreateTask = "in.php";
  static #endpointGetResults = "res.php";

  constructor(serviceKey) {
    this.serviceKey = serviceKey;
    // В Node.js fetch доступен глобально, как и requests.Session в Python
  }

  /**
   * Solves an hCaptcha.
   * @param {string} pageurl - The URL of the page where the hCaptcha is located.
   * @param {string} sitekey - The sitekey of the hCaptcha.
   * @param {string} ua - The User-Agent string to use.
   * @returns {Promise<string>} The hCaptcha token.
   * @throws {CaptchaSolverException} If there's an error during solving.
   */
  async solveHcaptcha(pageurl, sitekey, ua) {
    const taskId = await this.createTask(pageurl, sitekey, "hcaptcha", ua);
    console.log(taskId);
    const token = await this.getResult(taskId);
    return token;
  }

  /**
   * Creates a new captcha solving task.
   * @param {string} pageurl - The URL of the page.
   * @param {string} sitekey - The sitekey.
   * @param {string} method - The captcha method (e.g., "hcaptcha").
   * @param {string} ua - The User-Agent string.
   * @returns {Promise<string>} The task ID.
   * @throws {CaptchaSolverException} On API errors.
   */
  async createTask(pageurl, sitekey, method, ua) {
    const data = new URLSearchParams({
      pageurl: pageurl,
      method: method,
      sitekey: sitekey,
      userAgent: ua,
      key: this.serviceKey
    });
    console.log(data);
    const res = await fetch(`${CaptchaSolver.#apiServer}${CaptchaSolver.#endpointCreateTask}`, {
      method: 'POST',
      body: data
    });

    const result = await res.text();
    const [status, taskIdOrError] = result.split("|");
    console.log('taskIdOrError', result);
    if (status !== "OK") {
      if (status === "ERROR_KEY_DOES_NOT_EXIST") {
        throw new CaptchaSolverWrongKeyException("Check your API key");
      }
      if (status === "ERROR_ZERO_BALANCE") {
        throw new CaptchaSolverZeroBalanceException("Check your account balance");
      }
      throw new CaptchaSolverException(taskIdOrError);
    }
    return taskIdOrError;
  }

  /**
   * Retrieves the result of a captcha solving task.
   * @param {string} taskId - The ID of the task.
   * @returns {Promise<string>} The captcha token.
   * @throws {CaptchaSolverException} On API errors or timeout.
   */
  async getResult(taskId) {
    const params = new URLSearchParams({
      action: "get",
      key: this.serviceKey,
      id: taskId
    });

    const solvingStartTime = Date.now(); // Use Date.now() for milliseconds
    const timeout = 120 * 1000; // 120 seconds in milliseconds

    while (true) {
      if (Date.now() - solvingStartTime > timeout) {
        throw new CaptchaSolverTimeoutException();
      }

      // Wait for 4 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 4000));

      const res = await fetch(`${CaptchaSolver.#apiServer}${CaptchaSolver.#endpointGetResults}?${params.toString()}`);
      const result = await res.text();

      if (result !== "CAPCHA_NOT_READY") {
        const [status, tokenOrError] = result.split("|");
        if (status !== "OK") {
          throw new CaptchaSolverException(tokenOrError);
        }
        return tokenOrError;
      }
    }
  }
}
