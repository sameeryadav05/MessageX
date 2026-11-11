import type { BrokerErrorShape } from "./types.js";

export class MessageXError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageXError";
  }
}

export class MessageXConnectionError extends MessageXError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageXConnectionError";
  }
}

export class MessageXTimeoutError extends MessageXError {
  constructor(message: string) {
    super(message);
    this.name = "MessageXTimeoutError";
  }
}

export class MessageXBrokerError extends MessageXError {
  readonly code: string;

  constructor(error: BrokerErrorShape) {
    super(error.message);
    this.name = "MessageXBrokerError";
    this.code = error.code;
  }
}