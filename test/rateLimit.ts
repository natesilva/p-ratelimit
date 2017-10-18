/// <reference types="redis" />

import * as redis from 'fakeredis';

import { Quota, QuotaManager, RedisQuotaManager } from '../src';

import { RedisClient } from 'redis';
import { pRateLimit } from '../src/rateLimit';
import test from 'ava';
import { uniqueId } from '../src/util';

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

  let completed = 0;

  const fn = () => new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
      completed++;
    }, 200)
  });

  const promises = [
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn)
  ];

  await new Promise(resolve => setTimeout(resolve, 250));

  t.is(completed, 2, 'after 250 ms 2 jobs are done');

  await new Promise(resolve => setTimeout(resolve, 200));

  t.is(completed, 3, 'after another 200 ms all 3 jobs are done');
});

test('rate limits are enforced', async t => {
  const quota: Quota = { interval: 500, rate: 3 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  let completed = 0;

  const fn = () => new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
      completed++;
    }, 200)
  });

  const promises = [
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn)
  ];

  t.is(quotaManager.activeCount, 3, 'initially 3 jobs are active');
  await new Promise(resolve => setTimeout(resolve, 600));
  t.is(completed, 3, 'after 600 ms 3 jobs are done');
  t.is(quotaManager.activeCount, 2, '2 jobs are now active');
  await new Promise(resolve => setTimeout(resolve, 200));
  t.is(completed, 5, 'all 5 jobs are done');
  t.is(quotaManager.activeCount, 0, 'no jobs are still active');
});

test('combined rate limits and concurrency are enforced', async t => {
  const quota: Quota = { interval: 500, rate: 3, concurrency: 2 };
  const quotaManager = new QuotaManager(quota);
  const rateLimit = pRateLimit(quotaManager);

  let completed = 0;

  const fn = () => new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
      completed++;
    }, 200)
  });

  const promises = [
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn)
  ];

  t.is(quotaManager.activeCount, 2, 'only 2 jobs are started due to concurrency limit');
  await new Promise(resolve => setTimeout(resolve, 250));
  t.is(completed, 2, 'after 250 ms 2 jobs are done');
  t.is(quotaManager.activeCount, 1, 'rate limit allowed another job to start');
  await new Promise(resolve => setTimeout(resolve, 400));
  t.is(completed, 3, 'after another 400 ms 3 jobs are done');
  t.is(quotaManager.activeCount, 2, 'now 2 previously-queued jobs are running');
  await new Promise(resolve => setTimeout(resolve, 200));
  t.is(quotaManager.activeCount, 0, 'no jobs are still running');
  t.is(completed, 5, 'all jobs are done');
});

test('API calls are queued until RedisQuotaManager is ready', async t => {
  const client: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient: RedisClient = redis.createClient(6379, 'localhost');

  const quota: Quota = { rate: 300, interval: 1000, concurrency: 100 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client, pubSubClient);

  const rateLimit = pRateLimit(qm);

  let completed = 0;

  const fn = () => new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
      completed++;
    }, 200)
  });

  const promises = [
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn)
  ];

  t.is(qm.activeCount, 0);
  t.is(completed, 0);

  await qm.ready;

  t.is(qm.activeCount, 5);
  t.is(completed, 0);

  await Promise.all(promises);
  t.is(qm.activeCount, 0);
  t.is(completed, 5);
});

test('can handle API calls that reject', async t => {
  const quota: Quota = { interval: 500, rate: 3, concurrency: 2 };
  const rateLimit = pRateLimit(quota);

  let completed = 0;

  const fn = () => new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (completed % 2) { resolve(); }
      else { reject(new Error()); }
      completed++;
    }, 200)
  });

  const promises = [
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn),
    rateLimit(fn)
  ];

  await t.throws(Promise.all(promises));
});
