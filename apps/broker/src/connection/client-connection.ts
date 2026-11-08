
import net from "node:net";
import { randomUUID } from "node:crypto";

import { FrameDecoder } from "../protocol/frame-decoder.js";
import { FrameEncoder } from "../protocol/frame-encoder.js";
import { ProtocolParser } from "../protocol/protocol.parser.js";

import type { ValidatedProtocolMessage } from "../protocol/protocol.schema.js";

export class ClientConnection {
  public readonly id: string;

  private readonly decoder: FrameDecoder;

  private connected = true;

  private registeredClientName: string | null = null;

  private authenticatedUsername: string | null = null;

  constructor(
    private readonly socket: net.Socket,
    private readonly onMessage: (
      connection: ClientConnection,
      message: ValidatedProtocolMessage
    ) => void | Promise<void>,
    private readonly onClose: (
      connection: ClientConnection
    ) => void
  ) {
    this.id = randomUUID();

    this.decoder = new FrameDecoder();

    this.socket.setNoDelay(true);

    this.registerSocketEvents();
  }

  private registerSocketEvents(): void {
    this.socket.on("data", async (chunk: Buffer) => {
      try {
        const frames = this.decoder.push(chunk);

        for (const frame of frames) {
          const message = ProtocolParser.parse(frame);

          await this.onMessage(this, message);
        }
      } catch (error) {
        console.error(
          `[Connection ${this.id}] Protocol error:`,
          error instanceof Error ? error.message : error
        );

        this.close();
      }
    });

    this.socket.on("close", () => {
      this.handleClose();
    });

    this.socket.on("error", (error) => {
      console.error(
        `[Connection ${this.id}] Socket error:`,
        error.message
      );
    });
  }

  send(message: ValidatedProtocolMessage): void {
    if (!this.isConnected || this.socket.destroyed) {
      throw new Error("Connection is not available");
    }

    const frame = FrameEncoder.encode(message);

    this.socket.write(frame);
  }

  registerClient(clientName: string): void {
    if (!this.isConnected) {
      throw new Error("Cannot register a closed connection");
    }

    this.registeredClientName = clientName;
  }

  get clientName(): string | null {
    return this.registeredClientName;
  }

  authenticate(username: string): void {
    if (!this.isConnected) {
      throw new Error("Cannot authenticate a closed connection");
    }

    this.authenticatedUsername = username;
  }

  get username(): string | null {
    return this.authenticatedUsername;
  }

  get isAuthenticated(): boolean {
    return this.authenticatedUsername !== null;
  }

  close(): void {
    if (!this.connected) {
      return;
    }

    this.socket.destroy();
  }

  private handleClose(): void {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.authenticatedUsername = null;

    this.decoder.reset();

    console.log(
      `[Connection ${this.id}] Closed (client: ${this.clientName ?? "unregistered"})`
    );

    this.onClose(this);
  }

  get isConnected(): boolean {
    return this.connected && !this.socket.destroyed;
  }

  get remoteAddress(): string {
    return this.socket.remoteAddress ?? "unknown";
  }

  get remotePort(): number | undefined {
    return this.socket.remotePort;
  }
}
