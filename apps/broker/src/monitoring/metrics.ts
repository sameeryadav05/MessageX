interface MetricEvent {
  type:
    | "published"
    | "delivered"
    | "acknowledged"
    | "rejected"
    | "requeued"
    | "deadLettered"
    | "recovered";
  timestamp: number;
}

const counters = {
  published: 0,
  routedMessageCopies: 0,
  delivered: 0,
  acknowledged: 0,
  rejected: 0,
  requeued: 0,
  deadLettered: 0,
  recovered: 0
};

const events: MetricEvent[] = [];

function record(
  type: MetricEvent["type"],
  count = 1
): void {
  if (count <= 0) return;

  const now = Date.now();

  counters[type] += count;

  for (let i = 0; i < count; i++) {
    events.push({ type, timestamp: now });
  }

  // Keep only the most recent 60 seconds.
  const cutoff = now - 60_000;

  while (events.length > 0 && events[0].timestamp < cutoff) {
    events.shift();
  }
}

export const brokerMetrics = {
    recordPublished(routedQueues: number): void {
    record("published");
    counters.routedMessageCopies += routedQueues;
    },

  recordDelivered(): void {
    record("delivered");
  },

  recordAcknowledged(): void {
    record("acknowledged");
  },

  recordRejected(): void {
    record("rejected");
  },

  recordRequeued(): void {
    record("requeued");
  },

  recordDeadLettered(): void {
    record("deadLettered");
  },

  recordRecovered(): void {
    record("recovered");
  },

  getSnapshot() {
    const cutoff = Date.now() - 60_000;

    while (events.length > 0 && events[0].timestamp < cutoff) {
      events.shift();
    }

    const countLastMinute = (type: MetricEvent["type"]) =>
      events.filter((event) => event.type === type).length;

    return {
      totals: { ...counters },
      lastMinute: {
        published: countLastMinute("published"),
        delivered: countLastMinute("delivered"),
        acknowledged: countLastMinute("acknowledged"),
        rejected: countLastMinute("rejected"),
        requeued: countLastMinute("requeued"),
        deadLettered: countLastMinute("deadLettered"),
        recovered: countLastMinute("recovered")
      },
      ratesPerSecond: {
        published: Number(
          (countLastMinute("published") / 60).toFixed(2)
        ),
        delivered: Number(
          (countLastMinute("delivered") / 60).toFixed(2)
        ),
        acknowledged: Number(
          (countLastMinute("acknowledged") / 60).toFixed(2)
        )
      }
    };
  }
};