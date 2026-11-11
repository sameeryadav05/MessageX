
import net from "node:net";

import { ClientConnection } from "../connection/client-connection.js";
import { ConnectionManager } from "../connection/connection-manager.js";
import { CommandHandler } from "../commands/command.handler.js";
import { ConsumerManager } from "../consumers/consumer.manager.js";

export class TcpServer {
  private readonly server: net.Server;

  public readonly connectionManager: ConnectionManager;

  private readonly commandHandler: CommandHandler;
  public readonly consumerManager: ConsumerManager;

  private readonly cleanupTasks = new Set<Promise<void>>();

  private started = false;
  private closing = false;

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
          if (message.type !== "COMMAND") {
            console.warn(
              `[TCP] Unexpected message type from ${client.id}: ${message.type}`
            );
            return;
          }

          try {
            const response = await this.commandHandler.handle(
              client,
              message
            );

            client.send(response);
          } catch (error) {
            console.error(
              `[TCP] Command execution failed for ${client.id}:`,
              error
            );

            if (client.isConnected) {
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
          }
        },

        // Called whenever the connection closes.
        (client) => {
          this.connectionManager.remove(client.id);
          this.trackConnectionCleanup(client.id);
        }
      );

      this.connectionManager.add(connection);
    });

    this.server.on("error", (error) => {
      console.error("[TCP] Server error:", error);
    });
  }

  /**
   * Starts the TCP broker server.
   */
 /**
 * Starts the TCP broker server.
 */
start(
  port: number,
  host: string = "127.0.0.1"
): void {
  if (this.started) {
    throw new Error("TCP server has already been started");
  }

  if (this.closing) {
    throw new Error("Cannot start a TCP server that is closing");
  }

  this.started = true;

  this.server.listen(port, host, () => {
    console.log(
      `[TCP] MessageX Broker listening on ${host}:${port}`
    );
  });
}

  /**
   * Tracks asynchronous cleanup after a client disconnects.
   */
  private trackConnectionCleanup(connectionId: string): void {
    const task = this.consumerManager
      .removeConnection(connectionId)
      .catch((error) => {
        console.error(
          `[Consumer] Failed to recover messages for connection ${connectionId}:`,
          error
        );
      })
      .finally(() => {
        this.cleanupTasks.delete(task);
      });

    this.cleanupTasks.add(task);
  }

  /**
   * Stops accepting connections, closes active connections,
   * and waits for message recovery to finish.
   */
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }

    this.closing = true;

    console.log("[TCP] Closing TCP server...");

    // Stop accepting new connections.
    const serverClosed = new Promise<void>((resolve, reject) => {
      if (!this.started || !this.server.listening) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    // Closing sockets triggers the connection cleanup callbacks.
    this.connectionManager.closeAll();

    try {
      // Wait until all active TCP connections have closed.
      await serverClosed;

      // Wait for all disconnect recovery operations.
      while (this.cleanupTasks.size > 0) {
        await Promise.all([...this.cleanupTasks]);
      }

      console.log(
        "[TCP] Server stopped and connection recovery completed"
      );
    } catch (error) {
      console.error("[TCP] Shutdown error:", error);
      throw error;
    }
  }

  /**
   * Recovers messages whose acknowledgement timeout has expired.
   */
  async recoverExpiredDeliveries(
    timeoutSeconds: number
  ): Promise<number> {
    return this.consumerManager.recoverExpiredDeliveries(
      timeoutSeconds
    );
  }
}
