import * as redis from 'redis';

import { Quota, QuotaManager, RedisQuotaManager } from '../src';

import { Dequeue } from '../src/dequeue';
import { RedisClient } from 'redis';
import { pRateLimit } from '../src/rateLimit';
import test from 'ava';
import { uniqueId, sleep } from '../src/util';

// testing requires a real Redis server
// fakeredis, redis-mock, redis-js, etc. have missing or broken client.duplicate()
const REDIS_SERVER = 'localhost';
const REDIS_PORT = 6379;

/** Wait until the RQM is online */
async function waitForReady(rqm: RedisQuotaManager) {
  const expireAt = Date.now() + 5000;
  while (!rqm.ready) {
    if (Date.now() >= expireAt) {
      throw new Error('RedisQuotaManager still not ready after 5 seconds');
    }
    await sleep(100);
  }
}

/** Create a mock rate-limited API function. */
class MockApi {
  public nowRunning = 0;
  public fulfilled = 0;
  public rejected = 0;
  private invocations = new Dequeue();

  /**
   * @param quota the quota to be enforced by this API
   * @param waitTime how long the function should sleep (simulates latency)
   */
  constructor(private readonly quota: Quota, private readonly waitTime = 200) { }

  private checkRateLimits() {
    if (this.quota.concurrency !== undefined && this.nowRunning >= this.quota.concurrency) {
      this.rejected++;
      throw new Error(`too many concurrent invocations - ${this.nowRunning} already running`);
    }

    if (this.quota.interval && this.quota.rate) {
      const expired = Date.now() - this.quota.interval;
      while (this.invocations.peekFront() < expired) { this.invocations.shift(); }
      if (this.invocations.length >= this.quota.rate) {
        this.rejected++;
        throw new Error(`rate limiting prevents this from running`);
      }
    }
  }

  /** API function that rejects if rate limits are exceeded, fulfills otherwise. */
  async fn() {
    this.checkRateLimits();
    this.nowRunning++;
    this.invocations.push(Date.now());
    await sleep(this.waitTime);
    this.nowRunning--;
    this.fulfilled++;
  }

  /** API function that always rejects. */
  async reject() {
    this.checkRateLimits();
    this.nowRunning++;
    this.invocations.push(Date.now());
    await sleep(this.waitTime);
    this.nowRunning--;
    this.rejected++;
    return Promise.reject(new Error('mock API rejected this Promise'));
  }
}

test('can construct from a Quota object', async t => {
  const quota: Quota = { concurrency: 2 };
  const rateLimit = pRateLimit(quota);
  t.truthy(rateLimit);
});

test('can construct from a QuotaManager object', async t => {
  const quota: Quota = { concurrency: 2 };
  const qm = new QuotaManager(quota);
  const rateLimit = pRateLimit(qm);
  t.truthy(rateLimit);
});

test('concurrency is enforced', async t => {
  const quota: Quota = { concurrency: 2 };
  const rateLimit = pRateLimit(quota);

  const api = new MockApi(quota, 200);

  const promises = [
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn())
  ];

  await sleep(250);

  t.is(api.fulfilled, 2, 'after 250 ms 2 jobs are done');

  await sleep(200);

  t.is(api.fulfilled, 3, 'after another 200 ms all 3 jobs are done');
});

test('rate limits are enforced', async t => {
  const quota: Quota = { interval: 500, rate: 3 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  const api = new MockApi(quota, 200);

  const promises = [
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn())
  ];

  t.is(quotaManager.activeCount, 3, 'initially 3 jobs are active');
  await sleep(600);
  t.is(api.fulfilled, 3, 'after 600 ms 3 jobs are done');
  t.is(quotaManager.activeCount, 2, '2 jobs are now active');
  await sleep(400);
  t.is(api.fulfilled, 5, 'all 5 jobs are done');
  t.is(quotaManager.activeCount, 0, 'no jobs are still active');
});

test('combined rate limits and concurrency are enforced', async t => {
  const quota: Quota = { interval: 500, rate: 3, concurrency: 2 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  const api = new MockApi(quota, 200);

  const promises = [
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn())
  ];

  t.is(quotaManager.activeCount, 2, 'only 2 jobs are started due to concurrency limit');
  await sleep(250);
  t.is(api.fulfilled, 2, 'after 250 ms 2 jobs are done');
  t.is(quotaManager.activeCount, 1, 'rate limit allowed another job to start');
  await sleep(400);
  t.is(api.fulfilled, 3, 'after another 400 ms 3 jobs are done');
  t.is(quotaManager.activeCount, 2, 'now 2 previously-queued jobs are running');
  await sleep(400);
  t.is(quotaManager.activeCount, 0, 'no jobs are still running');
  t.is(api.fulfilled, 5, 'all jobs are done');
});

test('API calls are queued until RedisQuotaManager is ready', async t => {
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 300, interval: 1000, concurrency: 100 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  const rateLimit = pRateLimit(qm);

  const api = new MockApi(quota, 200);
  const promises = [
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.fn())
  ];

  t.is(qm.activeCount, 0);
  t.is(api.fulfilled, 0);

  await waitForReady(qm);
  await sleep(100);

  t.is(qm.activeCount, promises.length, 'all the jobs are running now');
  t.is(api.fulfilled, 0, 'none of the jobs are completed yet');

  await Promise.all(promises);
  t.is(qm.activeCount, 0, 'no jobs are running now');
  t.is(api.fulfilled, promises.length, 'all of the jobs are completed');
});

test('can handle API calls that reject', async t => {
  const quota: Quota = { interval: 500, rate: 10, concurrency: 10 };
  const rateLimit = pRateLimit(quota);

  const api = new MockApi(quota, 200);

  const promises = [
    rateLimit(() => api.fn()),
    rateLimit(() => api.reject()),
    rateLimit(() => api.fn()),
    rateLimit(() => api.reject()),
    rateLimit(() => api.fn())
  ];

  await t.throws(Promise.all(promises));

  // wait for them all to complete (rejected or not)
  await Promise.all(promises.map(async p => {
    try { await p; }
    catch { /* ignore */ }
  }));

  t.is(api.rejected, 2, '2 Promises were rejected');
  t.is(api.fulfilled, 3, '3 Promises were fulfilled');
});
