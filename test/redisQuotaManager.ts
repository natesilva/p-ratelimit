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

  t.is(qm.start(), true, 'start job (1)');
  t.is(qm.start(), true, 'start job (2)');
  t.is(qm.start(), false, 'would exceed max concurrency of 2');
  qm.end();
  t.is(qm.start(), true, 'start job (3)');
  t.is(qm.activeCount, 2);
  t.is(qm.start(), false, 'would exceed quota of 3 per 1/2 second');
  t.is(qm.activeCount, 2, 'still 2 running');
  qm.end();
  t.is(qm.activeCount, 1, 'still 1 running');
  t.is(qm.start(), false, 'still would exceed quota of 3 per 1/2 second');
  await new Promise(resolve => setTimeout(resolve, 600));
  t.is(qm.activeCount, 1, 'still 1 running, after timeout');
  t.is(qm.start(), true, 'start job (4)');
  t.is(qm.activeCount, 2, 'still 2 running');
  t.is(qm.start(), false, 'would exceed max concurrency of 2');
  qm.end();
  t.is(qm.start(), true, 'start job (5)');
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

  t.is(qm1.start(), true, 'job 1 started on client 1');
  t.is(qm2.start(), true, 'job 2 started on client 2');
  t.is(qm1.start(), false, 'would exceed the per-client max concurrency of 1');
  qm1.end();
  t.is(qm1.start(), true, 'job 3 started on client 1');
  t.is(qm1.activeCount, 1, '1 job active on client 1');
  t.is(qm2.activeCount, 1, '1 job active on client 2');
  qm2.end();
  t.is(qm2.activeCount, 0, 'no jobs active on client 2');
  qm1.end();
  t.is(qm1.activeCount, 0, 'no jobs active on client 1');
  t.is(qm1.start(), false, 'would exceed per-client rate of 2 per 500 ms');
  t.is(qm1.activeCount, 0, 'no jobs active on client 1');
  t.is(qm2.start(), true, 'job 4 started on client 2');
  t.is(qm2.activeCount, 1, '1 job active on client 2');
  qm2.end();
  t.is(qm2.activeCount, 0, 'no jobs active on client 2');
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
