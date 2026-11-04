
import { startHttpServer } from "./http.server.js";
import { TcpServer } from "./tcp.server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
const TCP_PORT = Number(process.env.TCP_PORT) || 5678;

console.log("================================");
console.log("       Starting MessageX        ");
console.log("================================");

const httpServer = startHttpServer(HTTP_PORT);

const tcpServer = new TcpServer();

tcpServer.start(TCP_PORT);

function shutdown(): void {
  console.log("\n MessageX Shutting down...");

  httpServer.close();

  tcpServer.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
