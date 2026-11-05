
import type { ClientConnection } from "../connection/client-connection.js";
import { handleQueueDeclare } from "./handlers/queue-declare.handler.js";

import type {
  ValidatedCommand,
  ValidatedResponse
} from "../protocol/protocol.schema.js";

import type {
  CommandHandlerFunction
} from "./command.types.js";

import { handleConnect } from "./handlers/connect.handler.js";

export class CommandHandler {
  private readonly handlers: Map<
    string,
    CommandHandlerFunction
  >;

  constructor() {
    this.handlers = new Map();
    // Register supported command handlers.
    this.handlers.set("CONNECT", handleConnect);

    this.handlers.set("CONNECT", handleConnect);
    this.handlers.set("QUEUE_DECLARE", handleQueueDeclare);
  }

  async handle(
    connection: ClientConnection,
    command: ValidatedCommand
  ): Promise<ValidatedResponse> {

    const handler = this.handlers.get(command.command);

    if (!handler) {
      return {
        version: 1,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_UNKNOWN_COMMAND",
          message: `No handler registered for command: ${command.command}`
        }
      };
    }

    return await handler({
      connection,
      command
    });
  }
}
