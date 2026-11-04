
import type { ClientConnection } from "../connection/client-connection.js";
import type {
  ValidatedCommand,
  ValidatedResponse
} from "../protocol/protocol.schema.js";

// Information passed to an individual command handler.
export interface CommandContext {
  connection: ClientConnection;
  command: ValidatedCommand;
}

// Every command handler must follow this function signature.
export type CommandHandlerFunction = (
  context: CommandContext
) => ValidatedResponse | Promise<ValidatedResponse>;
