/**
 * @sasurobert/multiversx-x402 Error Classes
 */

export class APIError extends Error {
  public readonly status: number;
  public readonly details: unknown;

  constructor(message: string, status: number = 500, details?: unknown) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.details = details;
  }
}

export class PaymentError extends APIError {
  public readonly errorCode?: string;

  constructor(message: string, status: number = 402, errorCode?: string, details?: unknown) {
    super(message, status, details);
    this.name = "PaymentError";
    this.errorCode = errorCode;
  }
}

export class SpendLimitError extends PaymentError {
  constructor(message: string, details?: unknown) {
    super(message, 402, "SPEND_LIMIT_EXCEEDED", details);
    this.name = "SpendLimitError";
  }
}

export class SignatureError extends PaymentError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "SIGNATURE_ERROR", details);
    this.name = "SignatureError";
  }
}

export class TimeoutError extends APIError {
  constructor(message: string = "Request timed out", details?: unknown) {
    super(message, 408, details);
    this.name = "TimeoutError";
  }
}
