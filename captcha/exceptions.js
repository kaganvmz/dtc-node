// --- Custom Exception Classes (Перевод из Python) ---
export class CaptchaSolverException extends Error {
  constructor(message = "CaptchaSolver error") {
    super(message);
    this.name = "CaptchaSolverException";
  }
}

export class CaptchaSolverZeroBalanceException extends CaptchaSolverException {
  constructor(message = "Check your account balance") {
    super(message);
    this.name = "CaptchaSolverZeroBalanceException";
  }
}

export class CaptchaSolverWrongKeyException extends CaptchaSolverException {
  constructor(message = "Check your API key") {
    super(message);
    this.name = "CaptchaSolverWrongKeyException";
  }
}

export class CaptchaSolverTimeoutException extends CaptchaSolverException {
  constructor(message = "Captcha solving timed out") {
    super(message);
    this.name = "CaptchaSolverTimeoutException";
  }
}