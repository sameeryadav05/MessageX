
import type { ValidatedProtocolMessage } from "../protocol/protocol.schema.js";
import { ClientConnection } from "./client-connection.js";

export class ConnectionManager {
  private readonly connections = new Map<
    string,
    ClientConnection
  >();

  add(connection: ClientConnection): void {
    this.connections.set(connection.id, connection);

    console.log(
      `[ConnectionManager] Client registered: ${connection.id}`
    );
  }

  remove(connectionId: string): void {
    const removed = this.connections.delete(connectionId);

    if (removed) {
      console.log(
        `[ConnectionManager] Client removed: ${connectionId}`
      );
    }
  }

  get(connectionId: string): ClientConnection | undefined {
    return this.connections.get(connectionId);
  }

  getAll(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  get count(): number {
    return this.connections.size;
  }

  broadcast(message: ValidatedProtocolMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.isConnected) {
        connection.send(message);
      }
    }
  }

  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.close();
    }
  }
}
