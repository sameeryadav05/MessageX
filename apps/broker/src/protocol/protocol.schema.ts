
import { z } from "zod";

import { PROTOCOL_VERSION } from "./protocol.constants.js";

// Commands supported by our initial protocol.
export const COMMANDS = [
  "CONNECT",
  "AUTH",
  "QUEUE_DECLARE",
  "EXCHANGE_DECLARE",
  "BIND",
  "PUBLISH",
  "CONSUME",
  "ACK",
  "NACK",
  "CANCEL",
  "HEARTBEAT"
] as const;

const BaseSchema = z.object({
  version: z.literal(PROTOCOL_VERSION)
});

// Client -> Broker
export const CommandSchema = BaseSchema.extend({
  type: z.literal("COMMAND"),
  command: z.enum(COMMANDS),
  requestId: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown())
}).strict();

// Broker -> Client
export const ResponseSchema = BaseSchema.extend({
  type: z.literal("RESPONSE"),
  requestId: z.string().min(1).max(128),
  success: z.boolean(),
  payload: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1)
  }).strict().optional()
}).strict().refine(
  (message) => {
    if (message.success) {
      return message.error === undefined;
    }

    return message.error !== undefined &&
      message.payload === undefined;
  },
  {
    message: "Successful responses cannot contain errors, and failed responses must contain an error without a payload"
  }
);

// Broker -> Client
export const EventSchema = BaseSchema.extend({
  type: z.literal("EVENT"),
  event: z.string().min(1),
  payload: z.record(z.string(), z.unknown())
}).strict();

export const ProtocolMessageSchema = z.discriminatedUnion("type", [
  CommandSchema,
  ResponseSchema,
  EventSchema
]);

// Infer TypeScript types directly from schemas.
export type ValidatedCommand = z.infer<typeof CommandSchema>;

export type ValidatedResponse = z.infer<typeof ResponseSchema>;

export type ValidatedEvent = z.infer<typeof EventSchema>;

export type ValidatedProtocolMessage =
  z.infer<typeof ProtocolMessageSchema>;
