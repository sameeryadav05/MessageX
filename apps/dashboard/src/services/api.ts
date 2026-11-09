import axios from "axios";import type {Queue,Exchange,Binding,BrokerConnection,Overview,DetailedHealth,Metrics} from "../types";
const api=axios.create({baseURL:import.meta.env.VITE_API_BASE_URL||"",timeout:8000,headers:{Accept:"application/json"}});
export async function getOverview():Promise<Overview>{return (await api.get("/api/overview")).data.overview}
export async function getDetailedHealth():Promise<DetailedHealth>{return (await api.get("/api/health/detailed")).data}
export async function getMetrics():Promise<Metrics>{const d=(await api.get("/api/metrics")).data;return d.metrics??{}}
export async function getQueues():Promise<Queue[]>{return (await api.get("/api/queues")).data.queues??[]}
export async function getQueueStats(name:string){return (await api.get(`/api/queues/${encodeURIComponent(name)}/stats`)).data}
export async function getExchanges():Promise<Exchange[]>{return (await api.get("/api/exchanges")).data.exchanges??[]}
export async function getBindings():Promise<Binding[]>{return (await api.get("/api/bindings")).data.bindings??[]}
export async function getConnections():Promise<BrokerConnection[]>{return (await api.get("/api/connections")).data.connections??[]}
export async function getBasicHealth(){return (await api.get("/health")).data}
