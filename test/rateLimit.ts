import { strict as assert } from "node:assert";
import { suite, test } from "node:test";
import { scheduler } from "node:timers/promises";
import { type Quota, QuotaManager, RedisQuotaManager } from "../src/index.ts";
import type { RedisCompatibleClient } from "../src/quota/redisQuotaManager.ts";
import { pRateLimit } from "../src/rateLimit.ts";
import { RateLimitTimeoutError } from "../src/rateLimitTimeoutError.ts";
import { uniqueId } from "../src/util.ts";
import { MockRedisBroker, MockRedisClient } from "./helpers/mock-redis-broker.ts";

// A mock Redis "server" to use for testing
const mockRedis = new MockRedisBroker();

/** Wait until the RQM is online */
async function waitForReady(rqm: RedisQuotaManager) {
  const expireAt = Date.now() + 5000;
  while (!rqm.ready) {
    if (Date.now() >= expireAt) {
      throw new Error("RedisQuotaManager still not ready after 5 seconds");
    }
    await scheduler.wait(100);
  }
  await scheduler.wait(100);
}

function mockApi(sleepTime: number) {
  const fn = async (err?: Error): Promise<void> => {
    fn.runCount++;
    if (err) {
      fn.rejectCount++;
      throw err;
    }
    await scheduler.wait(sleepTime);
    fn.fulfillCount++;
  };

  fn.runCount = 0;
  fn.rejectCount = 0;
  fn.fulfillCount = 0;

  return fn;
}

suite("rateLimit", { concurrency: true }, () => {
  test("can construct from a Quota object", async (_t) => {
    const quota: Quota = { concurrency: 2 };
    const rateLimit = pRateLimit(quota);
    assert.ok(rateLimit);
  });

  test("can construct from a QuotaManager object", async (_t) => {
    const quota: Quota = { concurrency: 2 };
    const qm = new QuotaManager(quota);
    const rateLimit = pRateLimit(qm);
    assert.ok(rateLimit);
  });

  test("concurrency is enforced", async (_t) => {
    const quota: Quota = { concurrency: 2 };
    const rateLimit = pRateLimit(quota);

    const api = mockApi(500);

    const startTime = Date.now();

    const _promises = [
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 500-1000 ms
    ];

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        assert.equal(api.fulfillCount, 0, "at t < 500, 0 jobs are done");
      } else if (elapsed > 600 && elapsed < 900) {
        assert.equal(api.fulfillCount, 2, "at 500 < t < 1000, 2 jobs are done");
      } else if (elapsed > 1200) {
        assert.equal(api.fulfillCount, 3, "at t > 1200, 3 jobs are done");
        break;
      }
      await scheduler.wait(200);
    }
  });

  test("rate limits are enforced", async (_t) => {
    const quota: Quota = { interval: 500, rate: 3 };
    const quotaManager = new QuotaManager(quota);
    const rateLimit = pRateLimit(quotaManager);

    const api = mockApi(500);

    const startTime = Date.now();

    const _promises = [
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 500-1000 ms
      rateLimit(() => api()), // 500-1000 ms
    ];

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        assert.equal(quotaManager.activeCount, 3, "at t < 500, 3 jobs are active");
        assert.equal(api.fulfillCount, 0, "at t < 500, 0 jobs are done");
      } else if (elapsed > 600 && elapsed < 900) {
        assert.equal(quotaManager.activeCount, 2, "at 500 < t < 1000, 2 jobs are active");
        assert.equal(api.fulfillCount, 3, "at 500 < t < 1000, 3 jobs are done");
      } else if (elapsed > 1200) {
        assert.equal(quotaManager.activeCount, 0, "at t > 1200, 0 jobs are active");
        assert.equal(api.fulfillCount, 5, "at t > 1200, 5 jobs are done");
        break;
      }
      await scheduler.wait(200);
    }
  });

  test("combined rate limits and concurrency are enforced", async (_t) => {
    const quota: Quota = { interval: 1000, rate: 3, concurrency: 2 };
    const quotaManager = new QuotaManager(quota);
    const rateLimit = pRateLimit(quotaManager);

    const api = mockApi(500);

    const startTime = Date.now();

    const _promises = [
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 0-500 ms
      rateLimit(() => api()), // 500-1000 ms
      rateLimit(() => api()), // 1000-1500 ms
      rateLimit(() => api()), // 1000-1500 ms
    ];

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        assert.equal(quotaManager.activeCount, 2, "at t < 500, 2 jobs are active");
        assert.equal(api.fulfillCount, 0, "at t < 500, 0 jobs are done");
      } else if (elapsed > 600 && elapsed < 900) {
        assert.equal(quotaManager.activeCount, 1, "at 500 < t < 1000, 1 job is active");
        assert.equal(api.fulfillCount, 2, "at 500 < t < 1000, 2 jobs are done");
      } else if (elapsed > 1100 && elapsed < 1400) {
        assert.equal(
          quotaManager.activeCount,
          2,
          "at 1000 < t < 1500, 2 jobs are active",
        );
        assert.equal(api.fulfillCount, 3, "at 1000 < t < 1500, 3 jobs are done");
      } else if (elapsed > 1700) {
        assert.equal(quotaManager.activeCount, 0, "at t > 1200, 0 jobs are active");
        assert.equal(api.fulfillCount, 5, "at t > 1200, 5 jobs are done");
        break;
      }
      await scheduler.wait(200);
    }
  });

  test("API calls are queued until RedisQuotaManager is ready", async (_t) => {
    const clients = [
      new MockRedisClient(mockRedis) as unknown as RedisCompatibleClient,
      new MockRedisClient(mockRedis) as unknown as RedisCompatibleClient,
    ];

    const quota: Quota = { rate: 300, interval: 1000, concurrency: 100 };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), clients);

    const rateLimit = pRateLimit(qm);

    const api = mockApi(500);

    const promises = [
      rateLimit(() => api()),
      rateLimit(() => api()),
      rateLimit(() => api()),
      rateLimit(() => api()),
      rateLimit(() => api()),
    ];

    assert.equal(qm.activeCount, 0);
    assert.equal(api.fulfillCount, 0);

    await waitForReady(qm);

    assert.equal(qm.activeCount, promises.length, "all the jobs are running now");
    assert.equal(api.fulfillCount, 0, "none of the jobs are completed yet");

    await Promise.all(promises);

    assert.equal(qm.activeCount, 0, "no jobs are running now");
    assert.equal(api.fulfillCount, promises.length, "all of the jobs are completed");
  });

  test("can handle API calls that reject", async (_t) => {
    const quota: Quota = { interval: 500, rate: 10, concurrency: 10 };
    const rateLimit = pRateLimit(quota);

    const api = mockApi(200);

    const promises = [
      rateLimit(() => api()),
      rateLimit(() => api(new Error())),
      rateLimit(() => api()),
      rateLimit(() => api(new Error())),
      rateLimit(() => api()),
    ];

    await assert.rejects(Promise.all(promises));

    // wait for them all to complete (rejected or not)
    await Promise.all(
      promises.map(async (p) => {
        try {
          await p;
        } catch {
          /* ignore */
        }
      }),
    );

    assert.equal(api.rejectCount, 2, "2 Promises were rejected");
    assert.equal(api.fulfillCount, 3, "3 Promises were fulfilled");
  });

  test("API calls that wait too long are rejected", async (_t) => {
    const quota: Quota = {
      interval: 1000,
      rate: 1,
      concurrency: 1,
      maxDelay: 500,
    };
    const rateLimit = pRateLimit(quota);

    const api = mockApi(200);

    const fn1 = rateLimit(() => api());
    const fn2 = rateLimit(() => api());

    await assert.doesNotReject(fn1);
    await assert.rejects(fn2, RateLimitTimeoutError);
  });

  test("Setting maxDelay to 0 disables maxDelay rejection", async (_t) => {
    const quota: Quota = { interval: 1000, rate: 1, concurrency: 1, maxDelay: 0 };
    const rateLimit = pRateLimit(quota);

    const api = mockApi(200);

    const fn1 = rateLimit(() => api());
    const fn2 = rateLimit(() => api());

    await assert.doesNotReject(fn1);
    await assert.doesNotReject(fn2);
  });

  test("Continues running the queue after a maxDelay timeout", async (t) => {
    t.mock.method(console, "warn", () => {});
    const quota: Quota = {
      interval: 1000,
      rate: 1,
      concurrency: 1,
      maxDelay: 500,
    };
    const rateLimit = pRateLimit(quota);

    const api = mockApi(200);

    const fn1 = rateLimit(() => api());
    const fn2 = rateLimit(() => api());
    const fn3 = rateLimit(() => api());

    await assert.doesNotReject(fn1);
    await assert.rejects(fn2, RateLimitTimeoutError);
    await assert.rejects(fn3, RateLimitTimeoutError);
  });

  test("Passing no quota is a no-op", async (t) => {
    t.mock.method(console, "warn", () => {});
    // TypeScript won’t allow this but it’s possible in JavaScript
    // biome-ignore lint/suspicious/noExplicitAny: legacy JavaScript functionality test
    const _rateLimit = (pRateLimit as any)();

    const api = mockApi(200);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; ++i) {
      promises.push(api());
    }

    await assert.doesNotReject(Promise.all(promises));
  });

  test("Passing no quota prints a console warning", async (t) => {
    const consoleWarn = t.mock.method(console, "warn");
    // TypeScript won’t allow this but it’s possible in JavaScript
    // biome-ignore lint/suspicious/noExplicitAny: legacy JavaScript functionality test
    const _rateLimit = (pRateLimit as any)();
    assert.match(consoleWarn.mock.calls[0].arguments[0], /created with no quota/);
  });

  test("Using an empty quota is a no-op", async (_t) => {
    const quota: Quota = {};
    const _rateLimit = pRateLimit(quota);

    const api = mockApi(200);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; ++i) {
      promises.push(api());
    }

    await assert.doesNotReject(Promise.all(promises));
  });
});
