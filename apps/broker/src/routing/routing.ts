
import { isDeepStrictEqual } from "node:util";

export type RoutingExchangeType =
  | "direct"
  | "fanout"
  | "topic"
  | "headers";

export type MessageHeaders = Record<string, unknown>;

export interface RoutingBinding {
  queueId: string;
  routingKey: string;
  arguments: MessageHeaders;
}

export interface RoutingInput {
  exchangeType: RoutingExchangeType;
  routingKey: string;
  headers: MessageHeaders;
  bindings: RoutingBinding[];
}

/**
 * Topic matching:
 *   * matches exactly one word.
 *   # matches zero or more words.
 *
 * Examples:
 *   orders.* matches orders.created
 *   orders.# matches orders.created.india
 *   #.created matches orders.created
 */
export function topicMatches(
  pattern: string,
  routingKey: string
): boolean {
  const patternParts = pattern.split(".");
  const routingParts = routingKey.split(".");

  const memo = new Map<string, boolean>();

  function match(patternIndex: number, routingIndex: number): boolean {
    const key = `${patternIndex}:${routingIndex}`;
    const cached = memo.get(key);

    if (cached !== undefined) {
      return cached;
    }

    let result: boolean;

    if (patternIndex === patternParts.length) {
      result = routingIndex === routingParts.length;
    } else {
      const part = patternParts[patternIndex]!;

      if (part === "#") {
        // # can match zero words or consume one word and remain active.
        result =
          match(patternIndex + 1, routingIndex) ||
          (
            routingIndex < routingParts.length &&
            match(patternIndex, routingIndex + 1)
          );
      } else if (part === "*") {
        result =
          routingIndex < routingParts.length &&
          match(patternIndex + 1, routingIndex + 1);
      } else {
        result =
          routingIndex < routingParts.length &&
          part === routingParts[routingIndex] &&
          match(patternIndex + 1, routingIndex + 1);
      }
    }

    memo.set(key, result);
    return result;
  }

  return match(0, 0);
}

/**
 * Headers matching:
 * x-match = "all": every binding argument must match.
 * x-match = "any": at least one binding argument must match.
 *
 * The x-match field itself is not compared with message headers.
 */
export function headersMatch(
  bindingArguments: MessageHeaders,
  messageHeaders: MessageHeaders
): boolean {
  const matchMode = bindingArguments["x-match"];

  if (matchMode !== undefined &&
      matchMode !== "all" &&
      matchMode !== "any") {
    return false;
  }

  const mode = matchMode ?? "all";

  const criteria = Object.entries(bindingArguments).filter(
    ([key]) => key !== "x-match"
  );

  if (criteria.length === 0) {
    return true;
  }

  const matches = criteria.map(([key, expectedValue]) =>
    Object.prototype.hasOwnProperty.call(messageHeaders, key) &&
    isDeepStrictEqual(messageHeaders[key], expectedValue)
  );

  return mode === "all"
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

/**
 * Returns unique queue IDs that match the exchange's routing rules.
 */
export function routeMessage(input: RoutingInput): string[] {
  const {
    exchangeType,
    routingKey,
    headers,
    bindings
  } = input;

  const matchedQueueIds = new Set<string>();

  for (const binding of bindings) {
    let matches = false;

    switch (exchangeType) {
      case "direct":
        matches = binding.routingKey === routingKey;
        break;

      case "fanout":
        matches = true;
        break;

      case "topic":
        matches = topicMatches(binding.routingKey, routingKey);
        break;

      case "headers":
        matches = headersMatch(binding.arguments, headers);
        break;
    }

    if (matches) {
      matchedQueueIds.add(binding.queueId);
    }
  }

  return [...matchedQueueIds];
}
