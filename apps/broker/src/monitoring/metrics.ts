type MetricType =
  | "published"
  | "delivered"
  | "acknowledged"
  | "rejected"
  | "requeued"
  | "deadLettered"
  | "recovered";

type MetricCounts = Record<MetricType, number>;

interface MetricBucket {
  second: number;
  counts: MetricCounts;
}

function createEmptyCounts(): MetricCounts {
  return {
    published: 0,
    delivered: 0,
    acknowledged: 0,
    rejected: 0,
    requeued: 0,
    deadLettered: 0,
    recovered: 0
  };
}

const totals: MetricCounts & {
  routedMessageCopies: number;
} = {
  ...createEmptyCounts(),
  routedMessageCopies: 0
};

// Fixed-size rolling window: one bucket per second.
const buckets: Array<MetricBucket | undefined> =
  new Array(60);

function getCurrentBucket(): MetricBucket {
  const second = Math.floor(Date.now() / 1000);
  const index = second % 60;

  let bucket = buckets[index];

  if (!bucket || bucket.second !== second) {
    bucket = {
      second,
      counts: createEmptyCounts()
    };

    buckets[index] = bucket;
  }

  return bucket;
}

function record(
  type: MetricType,
  count = 1
): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  const normalizedCount = Math.floor(count);

  if (normalizedCount <= 0) {
    return;
  }

  totals[type] += normalizedCount;

  const bucket = getCurrentBucket();
  bucket.counts[type] += normalizedCount;
}

function getLastMinuteCounts(): MetricCounts {
  const currentSecond = Math.floor(Date.now() / 1000);
  const result = createEmptyCounts();

  for (const bucket of buckets) {
    if (!bucket) {
      continue;
    }

    const age = currentSecond - bucket.second;

    if (age < 0 || age >= 60) {
      continue;
    }

    for (const type of Object.keys(result) as MetricType[]) {
      result[type] += bucket.counts[type];
    }
  }

  return result;
}

export const brokerMetrics = {
  recordPublished(routedQueues: number): void {
    record("published");

    if (Number.isFinite(routedQueues) && routedQueues > 0) {
      totals.routedMessageCopies += Math.floor(routedQueues);
    }
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
    const lastMinute = getLastMinuteCounts();

    return {
      totals: { ...totals },

      lastMinute,

      ratesPerSecond: {
        published: Number(
          (lastMinute.published / 60).toFixed(2)
        ),

        delivered: Number(
          (lastMinute.delivered / 60).toFixed(2)
        ),

        acknowledged: Number(
          (lastMinute.acknowledged / 60).toFixed(2)
        )
      }
    };
  }
};