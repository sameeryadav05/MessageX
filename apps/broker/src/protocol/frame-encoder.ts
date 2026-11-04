// role -> 	Convert JSON objects into TCP frames


import {
  FRAME_HEADER_SIZE,
  MAX_FRAME_SIZE,
  MIN_FRAME_SIZE
} from "./protocol.constants.js";
 
export class FrameEncoder {
  static encode(message: unknown): Buffer {
    let json: string | undefined;

    try {
      json = JSON.stringify(message);
    } catch {
      throw new Error("Unable to serialize protocol message");
    }

    if (json === undefined) {
      throw new Error("Protocol message is not JSON serializable");
    }

    const payload = Buffer.from(json, "utf8");

    const payloadLength = payload.length;

    if (payloadLength < MIN_FRAME_SIZE) {
      throw new Error("Protocol frame cannot be empty");
    }

    if (payloadLength > MAX_FRAME_SIZE) {
      throw new Error("Protocol frame exceeds maximum size");
    }

    const header = Buffer.alloc(FRAME_HEADER_SIZE);

    header.writeUInt32BE(payloadLength, 0);

    return Buffer.concat([header, payload]);
  }
}
