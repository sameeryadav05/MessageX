import type { ClientConnection } from "../connection/client-connection.js";

import { ConsumerManager } from "../consumers/consumer.manager.js";

import type {
  ValidatedCommand,
  ValidatedResponse
} from "../protocol/protocol.schema.js";

import type { CommandHandlerFunction } from "./command.types.js";

import { handleConnect } from "./handlers/connect.handler.js";
import { handleQueueDeclare } from "./handlers/queue-declare.handler.js";
import { handleExchangeDeclare } from "./handlers/exchange-declare.handler.js";
import { handleBind } from "./handlers/bind.handler.js";
import { handlePublish } from "./handlers/publish.handler.js";
import { handleConsume } from "./handlers/consume.handler.js";

export class CommandHandler {
  private readonly handlers: Map<string, CommandHandlerFunction>;
  private readonly consumerManager: ConsumerManager;

  constructor(consumerManager = new ConsumerManager()) {
    this.consumerManager = consumerManager;
    this.handlers = new Map();

    this.handlers.set("CONNECT", handleConnect);
    this.handlers.set("QUEUE_DECLARE", handleQueueDeclare);
    this.handlers.set("EXCHANGE_DECLARE", handleExchangeDeclare);
    this.handlers.set("BIND", handleBind);
    this.handlers.set("PUBLISH", handlePublish);
    this.handlers.set("CONSUME", handleConsume);
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

    return handler({
      connection,
      command,
      consumerManager: this.consumerManager
    });
  }
}