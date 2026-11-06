
import net from "node:net";

import { ClientConnection } from "../connection/client-connection.js";
import { ConnectionManager } from "../connection/connection-manager.js";
import { CommandHandler } from "../commands/command.handler.js";
import { ConsumerManager } from "../consumers/consumer.manager.js";

export class TcpServer {
  private readonly server: net.Server;

  public readonly connectionManager: ConnectionManager;
  

  private readonly commandHandler: CommandHandler;
  private readonly consumerManager: ConsumerManager;

  constructor() {
  this.connectionManager = new ConnectionManager();
  this.consumerManager = new ConsumerManager();
  this.commandHandler = new CommandHandler(this.consumerManager);

    this.server = net.createServer((socket) => {
      console.log(
        `[TCP] Incoming connection: ${socket.remoteAddress}:${socket.remotePort}`
      );

      const connection = new ClientConnection(
        socket,

        // Called whenever a valid protocol message arrives.
        async (client, message) => {
          // Only process COMMAND messages.
          if (message.type !== "COMMAND") {
            console.warn(
              `[TCP] Unexpected message type from ${client.id}: ${message.type}`
            );
            return;
          }

          try {
            // Dispatch command to its respective handler.
            const response = await this.commandHandler.handle(
              client,
              message
            );

            // Send the response back through TCP.
            client.send(response);

          } catch (error) {
            console.error(
              `[TCP] Command execution failed for ${client.id}:`,
              error
            );

            client.send({
              version: 1,
              type: "RESPONSE",
              requestId: message.requestId,
              success: false,
              error: {
                code: "ERR_INTERNAL",
                message: "Internal broker error"
              }
            });
          }
        },

        // Called whenever the connection closes.
    (client) => {
      this.connectionManager.remove(client.id);

      void this.consumerManager.removeConnection(client.id).catch((error) => {
        console.error(
          `[Consumer] Failed to recover messages for connection ${client.id}:`,
          error
        );
      });
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
