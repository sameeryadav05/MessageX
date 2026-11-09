
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  topicMatches,
  headersMatch,
  routeMessage
} from "../src/routing/routing.js";

describe("MessageX Routing Engine", () => {
  describe("Topic matching", () => {
    it("matches an exact routing key", () => {
      assert.equal(
        topicMatches("orders.created", "orders.created"),
        true
      );
    });

    it("matches one word using *", () => {
      assert.equal(
        topicMatches("orders.*", "orders.created"),
        true
      );
    });

    it("does not let * match multiple words", () => {
      assert.equal(
        topicMatches("orders.*", "orders.created.india"),
        false
      );
    });

    it("matches multiple words using #", () => {
      assert.equal(
        topicMatches("orders.#", "orders.created.india"),
        true
      );
    });

    it("# matches zero words", () => {
      assert.equal(
        topicMatches("orders.#", "orders"),
        true
      );
    });

    it("matches a suffix using #", () => {
      assert.equal(
        topicMatches("#.created", "orders.created"),
        true
      );
    });

    it("does not match unrelated routing keys", () => {
      assert.equal(
        topicMatches("payments.*", "orders.created"),
        false
      );
    });
  });

  describe("Headers matching", () => {
    const messageHeaders = {
      format: "pdf",
      region: "india",
      priority: 5
    };

    it("matches all headers using x-match=all", () => {
      assert.equal(
        headersMatch(
          {
            "x-match": "all",
            format: "pdf",
            region: "india"
          },
          messageHeaders
        ),
        true
      );
    });

    it("rejects when one header differs using x-match=all", () => {
      assert.equal(
        headersMatch(
          {
            "x-match": "all",
            format: "pdf",
            region: "usa"
          },
          messageHeaders
        ),
        false
      );
    });

    it("matches at least one header using x-match=any", () => {
      assert.equal(
        headersMatch(
          {
            "x-match": "any",
            format: "docx",
            region: "india"
          },
          messageHeaders
        ),
        true
      );
    });

    it("rejects when no headers match using x-match=any", () => {
      assert.equal(
        headersMatch(
          {
            "x-match": "any",
            format: "docx",
            region: "usa"
          },
          messageHeaders
        ),
        false
      );
    });

    it("defaults to all matching when x-match is omitted", () => {
      assert.equal(
        headersMatch(
          { format: "pdf", region: "india" },
          messageHeaders
        ),
        true
      );
    });

    it("rejects an invalid x-match value", () => {
      assert.equal(
        headersMatch(
          { "x-match": "invalid", format: "pdf" },
          messageHeaders
        ),
        false
      );
    });
  });

  describe("Queue routing", () => {
    const bindings = [
      {
        queueId: "queue-1",
        routingKey: "orders.*",
        arguments: {}
      },
      {
        queueId: "queue-2",
        routingKey: "orders.#",
        arguments: {}
      },
      {
        queueId: "queue-3",
        routingKey: "payments.#",
        arguments: {}
      }
    ];

    it("routes topic messages to all matching queues", () => {
      const result = routeMessage({
        exchangeType: "topic",
        routingKey: "orders.created",
        headers: {},
        bindings
      });

      assert.deepEqual(
        result.sort(),
        ["queue-1", "queue-2"]
      );
    });

    it("routes fanout messages to every bound queue", () => {
      const result = routeMessage({
        exchangeType: "fanout",
        routingKey: "",
        headers: {},
        bindings
      });

      assert.equal(result.length, 3);
    });

    it("routes direct messages using exact keys", () => {
      const result = routeMessage({
        exchangeType: "direct",
        routingKey: "orders.created",
        headers: {},
        bindings
      });

      assert.deepEqual(result, []);
    });

    it("does not return duplicate queue IDs", () => {
      const result = routeMessage({
        exchangeType: "fanout",
        routingKey: "",
        headers: {},
        bindings: [
          {
            queueId: "queue-1",
            routingKey: "a",
            arguments: {}
          },
          {
            queueId: "queue-1",
            routingKey: "b",
            arguments: {}
          }
        ]
      });

      assert.deepEqual(result, ["queue-1"]);
    });

    it("routes headers messages using binding arguments", () => {
      const result = routeMessage({
        exchangeType: "headers",
        routingKey: "",
        headers: {
          format: "pdf",
          region: "india"
        },
        bindings: [
          {
            queueId: "queue-1",
            routingKey: "",
            arguments: {
              "x-match": "all",
              format: "pdf",
              region: "india"
            }
          },
          {
            queueId: "queue-2",
            routingKey: "",
            arguments: {
              "x-match": "any",
              format: "docx",
              region: "india"
            }
          }
        ]
      });

      assert.deepEqual(
        result.sort(),
        ["queue-1", "queue-2"]
      );
    });
  });
});
