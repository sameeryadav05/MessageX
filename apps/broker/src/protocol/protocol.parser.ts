
import { ProtocolMessageSchema } from "./protocol.schema.js";
import type { ValidatedProtocolMessage } from "./protocol.schema.js";

export class ProtocolParseError extends Error {
  constructor(
    message: string,
    public readonly code: string = "ERR_INVALID_PROTOCOL"
  ) {
    super(message);
    this.name = "ProtocolParseError";
  }
}

export class ProtocolParser {
  static parse(payload: Buffer): ValidatedProtocolMessage {
    let parsed: unknown;

    // Step 1: Convert JSON bytes into a JavaScript value.
    try {
      const json = new TextDecoder("utf-8", {
        fatal: true
      }).decode(payload);

      parsed = JSON.parse(json);
    } catch {
      throw new ProtocolParseError(
        "Invalid UTF-8 or JSON payload"
      );
    }

    // Step 2: Validate against the MessageX protocol.
    const result = ProtocolMessageSchema.safeParse(parsed);

    if (!result.success) {
      throw new ProtocolParseError(
        "Message does not follow the MessageX protocol: " +
        result.error.issues
          .map(issue => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
      );
    }

    return result.data;
  }
}
