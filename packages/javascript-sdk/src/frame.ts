const HEADER_SIZE = 4;
const DEFAULT_MAX_FRAME_SIZE = 1024 * 1024;

export function encodeFrame(
  message: unknown,
  maxFrameSize = DEFAULT_MAX_FRAME_SIZE
): Buffer {
  let json: string | undefined;

  try {
    json = JSON.stringify(message);
  } catch (error) {
    throw new TypeError("MessageX protocol message must be JSON serializable", {
      cause: error
    });
  }

  if (json === undefined) {
    throw new TypeError("MessageX protocol message must be JSON serializable");
  }

  const body = Buffer.from(json, "utf8");
  if (body.length === 0 || body.length > maxFrameSize) {
    throw new RangeError(`MessageX frame size must be between 1 and ${maxFrameSize} bytes`);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameSize = DEFAULT_MAX_FRAME_SIZE) {}

  push(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32BE(0);
      if (length < 1 || length > this.maxFrameSize) {
        this.reset();
        throw new RangeError(`Invalid MessageX frame length: ${length}`);
      }

      const frameLength = HEADER_SIZE + length;
      if (this.buffer.length < frameLength) break;

      frames.push(this.buffer.subarray(HEADER_SIZE, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
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