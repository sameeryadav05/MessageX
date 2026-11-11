export type ExchangeType = "direct" | "fanout" | "topic" | "headers";

export interface MessageXOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  clientName?: string;
  connectTimeout?: number;
  requestTimeout?: number;
  maxFrameSize?: number;
}

export interface QueueDeclareOptions {
  name: string;
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  maxDeliveryCount?: number;
  deadLetterQueue?: string;
}

export interface ExchangeDeclareOptions {
  name: string;
  type: ExchangeType;
  durable?: boolean;
}

export interface BindingOptions {
  exchangeName: string;
  queueName: string;
  routingKey?: string;
  arguments?: Record<string, unknown>;
}

export interface PublishOptions {
  exchangeName: string;
  routingKey?: string;
  message: unknown;
  headers?: Record<string, unknown>;
}

export interface ConsumeOptions {
  queueName: string;
  onMessage: (message: DeliveredMessage) => void | Promise<void>;
}

export interface DeliveredMessage {
  consumerTag: string;
  queueName: string;
  messageId: string;
  deliveryTag: string;
  body: unknown;
  headers: Record<string, unknown>;
  routingKey: string;
  deliveryCount: number;
  createdAt: string;
  ack(): Promise<void>;
  nack(options?: { requeue?: boolean }): Promise<void>;
}

export interface ConsumerSubscription {
  consumerTag: string;
  queueName: string;
  cancel(): Promise<void>;
}

export interface BrokerResponse<T extends Record<string, unknown> = Record<string, unknown>> {
  requestId: string;
  success: true;
  payload: T;
}

export interface BrokerErrorShape {
  code: string;
  message: string;
}

export interface ProtocolResponse {
  version: number;
  type: "RESPONSE";
  requestId: string;
  success: boolean;
  payload?: Record<string, unknown>;
  error?: BrokerErrorShape;
}

export interface ProtocolEvent {
  version: number;
  type: "EVENT";
  event: string;
  payload: Record<string, unknown>;
}

export type ProtocolMessage = ProtocolResponse | ProtocolEvent;

export interface QueueInfo {
  id: string;
  name: string;
  durable: boolean;
  exclusive: boolean;
  autoDelete: boolean;
  maxDeliveryCount?: number | null;
  deadLetterQueue?: string | null;
}

export interface ExchangeInfo {
  id: string;
  name: string;
  type: ExchangeType;
  durable: boolean;
}

export interface PublishResult {
  exchangeName: string;
  routedQueues: number;
}

export interface DeclareQueueResult {
  queue: QueueInfo;
}

export interface DeclareExchangeResult {
  exchange: ExchangeInfo;
}

export interface BindResult {
  binding: {
    id: string;
    exchangeName: string;
    queueName: string;
    routingKey: string;
    arguments: Record<string, unknown>;
  };
}