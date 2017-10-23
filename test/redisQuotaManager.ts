import * as redis from 'redis';

import { Quota, RedisQuotaManager } from '../src';
import { sleep, uniqueId } from '../src/util';

import { RedisClient } from 'redis';
import test from 'ava';

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

test('Redis quota manager works', async t => {
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  await waitForReady(qm);

  t.true(qm.start(), 'start job (1)');
  t.true(qm.start(), 'start job (2)');
  t.false(qm.start(), 'would exceed max concurrency of 2');
  qm.end();
  t.true(qm.start(), 'start job (3)');
  t.is(qm.activeCount, 2);
  t.false(qm.start(), 'would exceed quota of 3 per 1/2 second');
  qm.end();
  t.is(qm.activeCount, 1, 'still 1 running');
  t.false(qm.start(), 'still would exceed quota of 3 per 1/2 second');
  await sleep(600);
  t.is(qm.activeCount, 1, 'still 1 running, after sleep');
  t.true(qm.start(), 'start job (4)');
  t.is(qm.activeCount, 2, 'still 2 running');
  t.false(qm.start(), 'would exceed max concurrency of 2');
  qm.end();
  t.true(qm.start(), 'start job (5)');
  t.is(qm.activeCount, 2, 'still 2 running');
  qm.end();
  qm.end();
  t.is(qm.activeCount, 0, 'none running');
});

test('separate Redis quota managers coordinate', async t => {
  const client1: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const client2: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
  const channelName = uniqueId();
  const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client1);
  const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2);

  await Promise.all([waitForReady(qm1), waitForReady(qm2)]);

  // each quota manager should have been assigned 1/2 of the available quota
  let expectedQuota: Quota = {
    interval: quota.interval,
    rate: Math.floor(quota.rate / 2),
    concurrency: Math.floor(quota.concurrency / 2)
  };

  const actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, expectedQuota, 'client 1 has the correct quota');
  const actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, expectedQuota, 'client 2 has the correct quota');
});

test('Redis quota can be updated', async t => {
  const client1: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const client2: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);

  const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
  const channelName = uniqueId();
  const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client1);
  const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2);

  await Promise.all([waitForReady(qm1), waitForReady(qm2)]);

  // each quota manager should have been assigned 1/2 the overall quota
  let expectedQuota = Object.assign({}, quota);
  expectedQuota.rate = Math.floor(expectedQuota.rate / 2);
  expectedQuota.concurrency = Math.floor(expectedQuota.concurrency / 2);
  let actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, expectedQuota, 'client 1 quota should be correct');
  let actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, expectedQuota, 'client 2 quota should be correct');

  const client3: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const qm3: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client3);
  await waitForReady(qm3);

  // each quota manager should now have 1/3 the overall quota
  expectedQuota = Object.assign({}, quota);
  expectedQuota.rate = Math.floor(expectedQuota.rate / 3);
  expectedQuota.concurrency = Math.floor(expectedQuota.concurrency / 3);
  actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, expectedQuota, 'client 1 quota should be updated');
  actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, expectedQuota, 'client 2 quota should be updated');
  let actualQuota3 = qm3.quota;
  t.deepEqual(actualQuota3, expectedQuota, 'client 3 quota should be updated');
});

test('RedisQuotaManager has a zero concurrency quota before it’s ready', async t => {
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  t.is(qm.quota.concurrency, 0);
  await waitForReady(qm);
  t.is(qm.quota.concurrency, 2);
});

test('RedisQuotaManager with undefined concurrency has zero concurrency before it’s ready',
  async t =>
{
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 3, interval: 500 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  t.is(qm.quota.concurrency, 0);
  await waitForReady(qm);
  t.is(qm.quota.concurrency, undefined);
});

test('maxDelay applies to RedisQuotaManager even before it’s ready', async t => {
  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2, maxDelay: 250 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client);

  t.is(qm.quota.maxDelay, 250);
  await waitForReady(qm);
  t.is(qm.quota.maxDelay, 250);
});

test('RedisQuotaManager with fastStart = true will process requests right away',
  async t =>
{
  const channelName = uniqueId();

  const client: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const quota: Quota = { rate: 10, interval: 500, concurrency: 4, fastStart: true };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client);

  const client2: RedisClient = redis.createClient(REDIS_PORT, REDIS_SERVER);
  const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2);

  t.is(qm.quota.concurrency, quota.concurrency, 'starts with full concurrency quota');
  t.is(qm.quota.rate, quota.rate, 'starts with full rate quota');
  t.true(qm.ready, 'it’s ready immediately');
  // wait for peer discovery
  await sleep(3000);
  t.is(qm.quota.concurrency, Math.floor(quota.concurrency / 2), 'now has half the concurrency quota');
  t.is(qm.quota.rate, Math.floor(quota.rate / 2), 'now has half the rate quota');
});
