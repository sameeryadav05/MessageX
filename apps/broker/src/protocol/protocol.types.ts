
export type MessageType =
  | "COMMAND"
  | "RESPONSE"
  | "EVENT";

export interface ProtocolEnvelope {
  version: number;
  type: MessageType;
}

export interface CommandMessage extends ProtocolEnvelope {
  type: "COMMAND";
  command: string;
  requestId: string;
  payload: Record<string, unknown>;
}

export interface ResponseMessage extends ProtocolEnvelope {
  type: "RESPONSE";
  requestId: string;
  success: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

export interface EventMessage extends ProtocolEnvelope {
  type: "EVENT";
  event: string;
  payload: Record<string, unknown>;
}

export type ProtocolMessage =
  | CommandMessage
  | ResponseMessage
  | EventMessage;
