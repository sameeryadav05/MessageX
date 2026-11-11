
import axios from "axios";

import type {
  Queue,
  Exchange,
  Binding,
  BrokerConnection,
  Overview,
  DetailedHealth,
  Metrics
} from "../types";

export const api = axios.create({
  baseURL: "",
  timeout: 8000,
  headers: {
    Accept: "application/json"
  }
});

export interface BrokerConfig {
  hostname: string;
  port: string;
  username: string;
  password: string;
}

export function configureBroker(config: BrokerConfig): boolean {
  const hostname = config.hostname.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  // Local development uses the Vite proxy.
  // Remote brokers are accessed directly.
const isSameOrigin =
  hostname === window.location.hostname &&
  (
    (window.location.protocol === "https:" &&
      config.port === "443") ||
    (window.location.protocol === "http:" &&
      config.port === window.location.port)
  );

api.defaults.baseURL = isSameOrigin
  ? ""
  : `${window.location.protocol}//${hostname}:${config.port}`;

  api.defaults.withCredentials = isSameOrigin;

  if (isSameOrigin) {
    delete api.defaults.headers.common.Authorization;
  } else {
    api.defaults.headers.common.Authorization =
      `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }

  return isSameOrigin;
}

export function disconnectBroker(): void {
  delete api.defaults.headers.common.Authorization;
  api.defaults.baseURL = "";
  api.defaults.withCredentials = false;
}

export async function loginToBroker(config: BrokerConfig): Promise<void> {
  const sameOrigin = configureBroker(config);

  if (sameOrigin) {
    await api.post("/api/auth/login", {
      username: config.username,
      password: config.password
    }, { withCredentials: true });
    return;
  }

  // Preserve Basic Authentication for brokers hosted on a different origin.
  try {
    await api.get("/api/overview");
  } catch (error) {
    disconnectBroker();
    throw error;
  }
}

export async function restoreBrokerSession(): Promise<BrokerConfig | null> {
  api.defaults.baseURL = "";
  api.defaults.withCredentials = true;
  delete api.defaults.headers.common.Authorization;

  try {
    const response = await api.get("/api/auth/session", {
      withCredentials: true
    });

    const port = window.location.protocol === "https:"
      ? "443"
      : (window.location.port || "80");

    return {
      hostname: window.location.hostname,
      port,
      username: response.data.user.username,
      password: ""
    };
  } catch (error: any) {
    if (error?.response?.status === 401) return null;
    throw error;
  }
}

export async function logoutFromBroker(): Promise<void> {
  try {
    await api.post("/api/auth/logout", {}, { withCredentials: true });
  } finally {
    disconnectBroker();
  }
}

export async function connectToBroker(
  config: BrokerConfig
): Promise<Overview> {
  configureBroker(config);

  try {
    const response = await api.get("/api/overview");
    return response.data.overview;
  } catch (error) {
    disconnectBroker();
    throw error;
  }
}

export async function getOverview(): Promise<Overview> {
  return (await api.get("/api/overview")).data.overview;
}

export async function getDetailedHealth(): Promise<DetailedHealth> {
  return (await api.get("/api/health/detailed")).data;
}

export async function getMetrics(): Promise<Metrics> {
  const data = (await api.get("/api/metrics")).data;
  return data.metrics ?? {};
}

export async function getQueues(): Promise<Queue[]> {
  return (await api.get("/api/queues")).data.queues ?? [];
}

export async function getQueueStats(name: string) {
  return (
    await api.get(
      `/api/queues/${encodeURIComponent(name)}/stats`
    )
  ).data;
}

export async function getExchanges(): Promise<Exchange[]> {
  return (await api.get("/api/exchanges")).data.exchanges ?? [];
}

export async function getBindings(): Promise<Binding[]> {
  return (await api.get("/api/bindings")).data.bindings ?? [];
}

export async function getConnections(): Promise<BrokerConnection[]> {
  return (await api.get("/api/connections")).data.connections ?? [];
}

export interface CreateQueueInput {
  name: string;
  durable?: boolean;
  autoDelete?: boolean;
  maxDeliveryCount?: number;
  deadLetterQueue?: string;
}

export interface CreateExchangeInput {
  name: string;
  type: "direct" | "fanout" | "topic" | "headers";
  durable?: boolean;
}

export interface CreateBindingInput {
  exchangeName: string;
  queueName: string;
  routingKey?: string;
  arguments?: Record<string, unknown>;
}

export async function createQueue(input: CreateQueueInput): Promise<void> {
  await api.post("/api/queues", input);
}

export async function deleteQueue(name: string): Promise<void> {
  await api.delete(`/api/queues/${encodeURIComponent(name)}`);
}

export async function createExchange(input: CreateExchangeInput): Promise<void> {
  await api.post("/api/exchanges", input);
}

export async function deleteExchange(name: string): Promise<void> {
  await api.delete(`/api/exchanges/${encodeURIComponent(name)}`);
}

export async function createBinding(input: CreateBindingInput): Promise<void> {
  await api.post("/api/bindings", input);
}

export async function deleteBinding(input: CreateBindingInput): Promise<void> {
  await api.delete("/api/bindings", { data: input });
}

export async function publishMessage(input: {
  exchangeName: string;
  routingKey?: string;
  message: unknown;
  headers?: Record<string, unknown>;
}): Promise<{ exchangeName: string; routedQueues: number }> {
  return (await api.post("/api/publish", input)).data.result;
}

export async function getBasicHealth() {
  return (await api.get("/health")).data;
}
