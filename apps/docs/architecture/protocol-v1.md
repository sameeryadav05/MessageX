
# MessageX Protocol Specification

Version: 1
Status: Initial Design

## 1. Transport

- Transport: TCP
- Default port: 5678
- Encoding: UTF-8
- Payload format: JSON
- Framing: Length-prefixed
- Length prefix: 4-byte unsigned integer
- Byte order: Big-endian
- Maximum frame size: 1 MiB

## 2. Message Envelope

Common fields:

- version
- type
- requestId
- payload

Message types:

- COMMAND
- RESPONSE
- EVENT

## 3. Commands

- CONNECT
- AUTH
- QUEUE_DECLARE
- EXCHANGE_DECLARE
- BIND
- PUBLISH
- CONSUME
- ACK
- NACK
- CANCEL
- HEARTBEAT

## 4. Responses

Every command requiring a response must contain
a matching requestId.

Successful response:

- version
- type: RESPONSE
- requestId
- success: true
- payload

Failed response:

- version
- type: RESPONSE
- requestId
- success: false
- error:
    - code
    - message

## 5. Events

Broker-generated asynchronous events:

- MESSAGE_DELIVERED
- CONNECTION_CLOSED
- FUTURE: additional broker events

Events do not require a requestId.

## 6. Connection Lifecycle

1. TCP connection
2. CONNECT
3. CONNECT RESPONSE
4. AUTH
5. AUTH RESPONSE
6. READY

## 7. Heartbeat

- Interval: 30 seconds
- Timeout: 90 seconds

## 8. Error Codes

- ERR_AUTH_FAILED
- ERR_INVALID_PROTOCOL
- ERR_INVALID_COMMAND
- ERR_INVALID_PAYLOAD
- ERR_PERMISSION_DENIED
- ERR_QUEUE_NOT_FOUND
- ERR_EXCHANGE_NOT_FOUND
- ERR_CONNECTION_CLOSED
- ERR_MESSAGE_TOO_LARGE
- ERR_INTERNAL

## 9. Security

- Credentials must be protected using TLS
  for remote connections.
- Authentication is required before
  messaging commands are accepted.
- Passwords must never be logged.
- Authentication failures must not reveal
  whether a username exists.

## 10. Future Compatibility

- Protocol version must be explicit.
- Future versions may introduce binary
  message payloads.
- Existing SDKs must follow the same protocol.
