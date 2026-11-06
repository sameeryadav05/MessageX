import type { ClientConnection } from "../connection/client-connection.js";
import type { ConsumerManager } from "../consumers/consumer.manager.js";

import type {
  ValidatedCommand,
  ValidatedResponse
} from "../protocol/protocol.schema.js";

export interface CommandContext {
  connection: ClientConnection;
  command: ValidatedCommand;
  consumerManager: ConsumerManager;
}

export type CommandHandlerFunction = (
  context: CommandContext
) => ValidatedResponse | Promise<ValidatedResponse>;