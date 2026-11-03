// role -> 		Extract complete frames from TCP chunks


import {
  FRAME_HEADER_SIZE,
  MAX_FRAME_SIZE,
  MIN_FRAME_SIZE
} from "./protocol.constants.js";

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) {
      return [];
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);

    const frames: Buffer[] = [];

    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      // Read the expected JSON payload length.
      const payloadLength = this.buffer.readUInt32BE(0);

      // Validate the frame length before extracting payload.
      if (
        payloadLength < MIN_FRAME_SIZE ||
        payloadLength > MAX_FRAME_SIZE
      ) {
        throw new Error(
          `Invalid frame length: ${payloadLength}`
        );
      }

      const totalFrameLength =
        FRAME_HEADER_SIZE + payloadLength;

      // Wait until the complete frame is available.
      if (this.buffer.length < totalFrameLength) {
        break;
      }

      // Extract the JSON payload.
      const payload = this.buffer.subarray(
        FRAME_HEADER_SIZE,
        totalFrameLength
      );

      frames.push(payload);

      // Remove the extracted frame.
      this.buffer = this.buffer.subarray(totalFrameLength);
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get bufferedBytes(): number {
    return this.buffer.length;
  }
}
