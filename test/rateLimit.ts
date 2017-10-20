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
  await sleep(100);
}

function mockApi(sleepTime: number) {
  const fn = async (err: Error = null): Promise<void> => {
    fn['runCount']++;
    if (err) {
      fn['rejectCount']++;
      throw err;
    }
    await sleep(sleepTime);
    fn['fulfillCount']++;
  };

  fn['runCount'] = 0;
  fn['rejectCount'] = 0;
  fn['fulfillCount'] = 0;

  return fn;
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

  const api = mockApi(500);

  const promises = [
    rateLimit(() => api()),
    rateLimit(() => api()),
    rateLimit(() => api())
  ];

  await sleep(600);

  t.is(api['fulfillCount'], 2, 'after 600 ms 2 jobs are done');

  await sleep(600);

  t.is(api['fulfillCount'], 3, 'after another 600 ms all 3 jobs are done');
});

test('rate limits are enforced', async t => {
  const quota: Quota = { interval: 500, rate: 3 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  const api = mockApi(500);

  const startTime = Date.now();

  const promises = [
    rateLimit(() => api()),   // 0-500 ms
    rateLimit(() => api()),   // 0-500 ms
    rateLimit(() => api()),   // 0-500 ms
    rateLimit(() => api()),   // 500-1000 ms
    rateLimit(() => api())    // 500-1000 ms
  ];

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed < 500) {
      t.is(quotaManager.activeCount, 3, 'at t < 500, 3 jobs are active');
      t.is(api['fulfillCount'], 0, 'at t < 500, 0 jobs are done');
    } else if (elapsed > 600 && elapsed < 900) {
      t.is(quotaManager.activeCount, 2, 'at 500 < t < 1000, 2 jobs are active')
      t.is(api['fulfillCount'], 3, 'at 500 < t < 1000, 3 jobs are done');
    } else if (elapsed > 1200) {
      t.is(quotaManager.activeCount, 0, 'at t > 1200, 0 jobs are active')
      t.is(api['fulfillCount'], 5, 'at t > 1200, 5 jobs are done');
      break;
    }
    await sleep(200);
  }
});

test('combined rate limits and concurrency are enforced', async t => {
  const quota: Quota = { interval: 1000, rate: 3, concurrency: 2 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  const api = mockApi(500);

  const startTime = Date.now();

  const promises = [
    rateLimit(() => api()),   // 0-500 ms
    rateLimit(() => api()),   // 0-500 ms
    rateLimit(() => api()),   // 500-1000 ms
    rateLimit(() => api()),   // 1000-1500 ms
    rateLimit(() => api())    // 1000-1500 ms
  ];

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed < 500) {
      t.is(quotaManager.activeCount, 2, 'at t < 500, 2 jobs are active');
      t.is(api['fulfillCount'], 0, 'at t < 500, 0 jobs are done');
    } else if (elapsed > 600 && elapsed < 900) {
      t.is(quotaManager.activeCount, 1, 'at 500 < t < 1000, 1 job is active')
      t.is(api['fulfillCount'], 2, 'at 500 < t < 1000, 2 jobs are done');
    } else if (elapsed > 1100 && elapsed < 1400) {
      t.is(quotaManager.activeCount, 2, 'at 1000 < t < 1500, 2 jobs are active')
      t.is(api['fulfillCount'], 3, 'at 1000 < t < 1500, 3 jobs are done');
    } else if (elapsed > 1700) {
      t.is(quotaManager.activeCount, 0, 'at t > 1200, 0 jobs are active')
      t.is(api['fulfillCount'], 5, 'at t > 1200, 5 jobs are done');
      break;
    }
    await sleep(200);
  }
});

test('API calls are queued until RedisQuotaManager is ready', async t => {
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 300, interval: 1000, concurrency: 100 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  const rateLimit = pRateLimit(qm);

  const api = mockApi(500);

  const promises = [
    rateLimit(() => api()),
    rateLimit(() => api()),
    rateLimit(() => api()),
    rateLimit(() => api()),
    rateLimit(() => api())
  ];

  t.is(qm.activeCount, 0);
  t.is(api['fulfillCount'], 0);

  await waitForReady(qm);

  t.is(qm.activeCount, promises.length, 'all the jobs are running now');
  t.is(api['fulfillCount'], 0, 'none of the jobs are completed yet');

  await Promise.all(promises);

  t.is(qm.activeCount, 0, 'no jobs are running now');
  t.is(api['fulfillCount'], promises.length, 'all of the jobs are completed');
});

test('can handle API calls that reject', async t => {
  const quota: Quota = { interval: 500, rate: 10, concurrency: 10 };
  const rateLimit = pRateLimit(quota);

  const api = mockApi(200);

  const promises = [
    rateLimit(() => api()),
    rateLimit(() => api(new Error())),
    rateLimit(() => api()),
    rateLimit(() => api(new Error())),
    rateLimit(() => api())
  ];

  await t.throws(Promise.all(promises));

  // wait for them all to complete (rejected or not)
  await Promise.all(promises.map(async p => {
    try { await p; }
    catch { /* ignore */ }
  }));

  t.is(api['rejectCount'], 2, '2 Promises were rejected');
  t.is(api['fulfillCount'], 3, '3 Promises were fulfilled');
});
