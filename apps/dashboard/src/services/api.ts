
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

export function configureBroker(config: BrokerConfig): void {
  const hostname = config.hostname.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1";

  const isDefaultLocal =
    isLocal && config.port === "3000";

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

  api.defaults.headers.common.Authorization =
    `Basic ${btoa(`${config.username}:${config.password}`)}`;
}

export function disconnectBroker(): void {
  delete api.defaults.headers.common.Authorization;
  api.defaults.baseURL = "";
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

export async function getBasicHealth() {
  return (await api.get("/health")).data;
}
