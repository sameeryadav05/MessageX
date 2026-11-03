
import net from "node:net";

import { ClientConnection } from "../connection/client-connection.js";
import { ConnectionManager } from "../connection/connection-manager.js";

export class TcpServer {
  private readonly server: net.Server;

  public readonly connectionManager: ConnectionManager;

  constructor() {
    this.connectionManager = new ConnectionManager();

    this.server = net.createServer((socket) => {
      console.log(
        `[TCP] Incoming connection: ${socket.remoteAddress}:${socket.remotePort}`
      );

      const connection = new ClientConnection(
        socket,

        // Called whenever a valid protocol message arrives.
        (client, message) => {
          console.log(
            `[TCP] Message received from ${client.id}:`,
            message
          );
        },

        // Called whenever the connection closes.
        (client) => {
          this.connectionManager.remove(client.id);
        }
      );

      this.connectionManager.add(connection);
    });

    this.server.on("error", (error) => {
      console.error("[TCP] Server error:", error);
    });
  }

  start(port: number): void {
    this.server.listen(port, "127.0.0.1", () => {
      console.log(
        `[TCP] MessageX Broker listening on 127.0.0.1:${port}`
      );
    });
  }

  close(): void {
    console.log("[TCP] Closing all client connections...");

    this.connectionManager.closeAll();

    this.server.close((error) => {
      if (error) {
        console.error("[TCP] Shutdown error:", error);
        return;
      }

      console.log("[TCP] Server stopped");
    });
  }
}
