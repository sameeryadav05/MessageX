import net from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { FrameDecoder, encodeFrame } from "./frame.js";
import {
  MessageXBrokerError,
  MessageXConnectionError,
  MessageXTimeoutError
} from "./errors.js";
import type {
  BindResult,
  BindingOptions,
  ConsumeOptions,
  ConsumerSubscription,
  DeclareExchangeResult,
  DeclareQueueResult,
  ExchangeDeclareOptions,
  MessageXOptions,
  PublishOptions,
  PublishResult,
  QueueDeclareOptions,
  ProtocolEvent,
  ProtocolMessage,
  ProtocolResponse
} from "./types.js";

interface PendingRequest {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const PROTOCOL_VERSION = 1;

export class MessageX extends EventEmitter {
  private socket: net.Socket | null = null;
  private decoder: FrameDecoder;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly consumers = new Map<string, ConsumeOptions>();
  private readonly pendingConsumersByQueue = new Map<string, ConsumeOptions>();
  private readonly options: Required<Pick<MessageXOptions,
    "host" | "port" | "username" | "password" | "clientName" |
    "connectTimeout" | "requestTimeout" | "maxFrameSize">>;
  private closing = false;
  private connected = false;
  private authenticated = false;
  private connectPromise: Promise<void> | null = null;

  readonly queue: {
    declare: (options: QueueDeclareOptions) => Promise<DeclareQueueResult>;
    delete: (queueName: string) => Promise<{ queueName: string; deleted: boolean }>;
  };

  readonly exchange: {
    declare: (options: ExchangeDeclareOptions) => Promise<DeclareExchangeResult>;
    delete: (exchangeName: string) => Promise<{ exchangeName: string; deleted: boolean }>;
    bind: (options: BindingOptions) => Promise<BindResult>;
    unbind: (options: BindingOptions) => Promise<{ exchangeName: string; queueName: string; removed: boolean }>;
  };

  constructor(options: MessageXOptions) {
    super();

    if (!options?.host || !options.username || !options.password) {
      throw new TypeError("host, username and password are required");
    }

    this.options = {
      host: options.host,
      port: options.port ?? 5678,
      username: options.username,
      password: options.password,
      clientName: options.clientName ?? "messagex-node-client",
      connectTimeout: options.connectTimeout ?? 10_000,
      requestTimeout: options.requestTimeout ?? 15_000,
      maxFrameSize: options.maxFrameSize ?? 1024 * 1024
    };
    this.decoder = new FrameDecoder(this.options.maxFrameSize);

    this.queue = {
      declare: async (input) => {
        const payload = await this.request("QUEUE_DECLARE", { ...input });
        return payload as unknown as DeclareQueueResult;
      },
      delete: async (queueName) => {
        const payload = await this.request("QUEUE_DELETE", { queueName });
        return payload as unknown as { queueName: string; deleted: boolean };
      }
    };

    this.exchange = {
      declare: async (input) => {
        const payload = await this.request("EXCHANGE_DECLARE", { ...input });
        return payload as unknown as DeclareExchangeResult;
      },
      delete: async (exchangeName) => {
        const payload = await this.request("EXCHANGE_DELETE", { exchangeName });
        return payload as unknown as { exchangeName: string; deleted: boolean };
      },
      bind: async (input) => {
        const payload = await this.request("BIND", {
          exchangeName: input.exchangeName,
          queueName: input.queueName,
          routingKey: input.routingKey ?? "",
          arguments: input.arguments ?? {}
        });
        return payload as unknown as BindResult;
      },
      unbind: async (input) => {
        const payload = await this.request("UNBIND", {
          exchangeName: input.exchangeName,
          queueName: input.queueName,
          routingKey: input.routingKey ?? "",
          arguments: input.arguments ?? {}
        });
        return payload as unknown as {
          exchangeName: string;
          queueName: string;
          removed: boolean;
        };
      }
    };
  }

  get isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed;
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.authenticated) return;
    if (this.connectPromise) return this.connectPromise;

    const attempt = this.establishConnection();
    this.connectPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.connectPromise === attempt) this.connectPromise = null;
    }
  }

  private async establishConnection(): Promise<void> {
    if (this.isConnected) {
      throw new MessageXConnectionError("Socket is connected but authentication is incomplete");
    }

    this.closing = false;
    this.decoder.reset();

    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port
    });
    this.socket = socket;
    socket.setNoDelay(true);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new MessageXTimeoutError(
          `Timed out connecting to ${this.options.host}:${this.options.port}`
        ));
      }, this.options.connectTimeout);

      const onError = (error: Error) => {
        clearTimeout(timer);
        reject(new MessageXConnectionError(
          `Could not connect to MessageX at ${this.options.host}:${this.options.port}: ${error.message}`,
          { cause: error }
        ));
      };

      socket.once("connect", () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve();
      });
      socket.once("error", onError);
    });

    this.connected = true;
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", (error) => this.handleSocketError(error));
    socket.on("close", () => this.handleClose());

    try {
      await this.request("CONNECT", { clientName: this.options.clientName });
      await this.request("AUTH", {
        username: this.options.username,
        password: this.options.password
      });
      this.authenticated = true;
      this.emit("connect");
    } catch (error) {
      this.destroySocket();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.authenticated = false;
    this.connected = false;
    this.consumers.clear();
    this.pendingConsumersByQueue.clear();

    if (this.socket && !this.socket.destroyed) {
      const socket = this.socket;
      await new Promise<void>((resolve) => {
        socket.end(resolve);
        const fallback = setTimeout(() => {
          if (!socket.destroyed) socket.destroy();
          resolve();
        }, 1_000);
        fallback.unref();
      });
    }

    this.rejectPending(new MessageXConnectionError("MessageX client was closed"));
    this.socket = null;
    this.emit("close");
  }

  async publish(options: PublishOptions): Promise<PublishResult> {
    const payload = await this.request("PUBLISH", {
      exchangeName: options.exchangeName,
      routingKey: options.routingKey ?? "",
      message: options.message,
      headers: options.headers ?? {}
    });
    return payload as unknown as PublishResult;
  }

  async consume(options: ConsumeOptions): Promise<ConsumerSubscription> {
    if (typeof options.onMessage !== "function") {
      throw new TypeError("consume requires an onMessage callback");
    }

    // The broker may emit MESSAGE_DELIVERED before replying to CONSUME.
    // Register the callback by queue before sending the command to avoid losing
    // the first delivery in that response/event race.
    this.pendingConsumersByQueue.set(options.queueName, options);
    let payload: Record<string, unknown>;
    try {
      payload = await this.request("CONSUME", {
        queueName: options.queueName
      });
    } catch (error) {
      this.pendingConsumersByQueue.delete(options.queueName);
      throw error;
    }
    this.pendingConsumersByQueue.delete(options.queueName);
    const consumerTag = String(payload.consumerTag ?? "");
    if (!consumerTag) {
      throw new MessageXConnectionError("Broker did not return a consumerTag");
    }

    this.consumers.set(consumerTag, options);
    let cancelled = false;

    return {
      consumerTag,
      queueName: options.queueName,
      cancel: async () => {
        if (cancelled) return;
        await this.request("CANCEL", { consumerTag });
        cancelled = true;
        this.consumers.delete(consumerTag);
      }
    };
  }

  private async request(
    command: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.socket || this.socket.destroyed || !this.connected) {
      throw new MessageXConnectionError("Not connected to MessageX. Call connect() first.");
    }
    if (command !== "CONNECT" && command !== "AUTH" && !this.authenticated) {
      throw new MessageXConnectionError("MessageX client is not authenticated. Await connect() before sending commands.");
    }

    const requestId = randomUUID();
    const frame = encodeFrame({
      version: PROTOCOL_VERSION,
      type: "COMMAND",
      command,
      requestId,
      payload
    }, this.options.maxFrameSize);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new MessageXTimeoutError(
          `MessageX command ${command} timed out after ${this.options.requestTimeout}ms`
        ));
      }, this.options.requestTimeout);

      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.write(frame, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(new MessageXConnectionError(
          `Failed to send ${command}: ${error.message}`,
          { cause: error }
        ));
      });
    });
  }

  private handleData(chunk: Buffer): void {
    try {
      for (const frame of this.decoder.push(chunk)) {
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame)) as ProtocolMessage;
        if (parsed.version !== PROTOCOL_VERSION) {
          throw new Error(`Unsupported broker protocol version: ${parsed.version}`);
        }
        if (parsed.type === "RESPONSE") this.handleResponse(parsed);
        else if (parsed.type === "EVENT") this.handleEvent(parsed);
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (this.listenerCount("error") > 0) this.emit("error", normalized);
      else this.emit("warning", normalized);
      this.destroySocket();
    }
  }

  private handleResponse(response: ProtocolResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.emit("warning", new Error(`Received response for unknown requestId ${response.requestId}`));
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);

    if (!response.success) {
      pending.reject(new MessageXBrokerError(
        response.error ?? { code: "ERR_UNKNOWN", message: "Broker command failed" }
      ));
      return;
    }

    pending.resolve(response.payload ?? {});
  }

  private handleEvent(event: ProtocolEvent): void {
    if (event.event !== "MESSAGE_DELIVERED") {
      this.emit("event", event);
      return;
    }

    const data = event.payload;
    const consumerTag = String(data.consumerTag ?? "");
    const subscription = this.consumers.get(consumerTag)
      ?? this.pendingConsumersByQueue.get(String(data.queueName ?? ""));
    if (!subscription) {
      this.emit("warning", new Error(`Message delivered for unknown consumer ${consumerTag}`));
      return;
    }

    const deliveryTag = String(data.deliveryTag ?? "");
    const delivered = {
      consumerTag,
      queueName: String(data.queueName ?? subscription.queueName),
      messageId: String(data.messageId ?? ""),
      deliveryTag,
      body: data.body,
      headers: (data.headers ?? {}) as Record<string, unknown>,
      routingKey: String(data.routingKey ?? ""),
      deliveryCount: Number(data.deliveryCount ?? 0),
      createdAt: String(data.createdAt ?? ""),
      ack: () => this.request("ACK", { deliveryTag }).then(() => undefined),
      nack: (options: { requeue?: boolean } = {}) =>
        this.request("NACK", { deliveryTag, requeue: options.requeue ?? true }).then(() => undefined)
    };

    Promise.resolve(subscription.onMessage(delivered)).catch((error) => {
      this.emit("consumerError", error, delivered);
    });
    this.emit("message", delivered);
  }

  private handleSocketError(error: Error): void {
    if (!this.closing) {
      const wrapped = new MessageXConnectionError(error.message, { cause: error });
      if (this.listenerCount("error") > 0) this.emit("error", wrapped);
      else this.emit("warning", wrapped);
    }
  }

  private handleClose(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.authenticated = false;
    this.socket = null;
    this.decoder.reset();
    this.consumers.clear();
    this.pendingConsumersByQueue.clear();
    this.rejectPending(new MessageXConnectionError("Connection to MessageX was closed"));
    if (!this.closing && wasConnected) this.emit("disconnect");
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private destroySocket(): void {
    this.connected = false;
    this.authenticated = false;
    this.consumers.clear();
    this.pendingConsumersByQueue.clear();
    this.rejectPending(new MessageXConnectionError("MessageX connection was terminated"));
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    this.socket = null;
  }
}