/// <reference types="redis" />

import * as redis from 'fakeredis';

import { Quota, RedisQuotaManager } from '../src';

import { RedisClient } from 'redis';
import test from 'ava';
import { uniqueId } from '../src/util';

test('Redis quota manager works', async t => {
  const client: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient: RedisClient = redis.createClient(6379, 'localhost');

  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), client, pubSubClient);

  await qm.ready;

  let canStart: boolean;
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
  const client1: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient1: RedisClient = redis.createClient(6379, 'localhost');

  const client2: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient2: RedisClient = redis.createClient(6379, 'localhost');

  const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
  const channelName = uniqueId();
  const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client1, pubSubClient1);
  const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2, pubSubClient2);

  await Promise.all([qm1.ready, qm2.ready]);

  // each quota manager should have been assigned 2 rate units and 1 concurrency unit
  // each quota manager should have been assigned 2 rate units and 1 concurrency unit
  const actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, { rate: 2, interval: 500, concurrency: 1 });
  const actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, { rate: 2, interval: 500, concurrency: 1 });

  t.is(qm1.start(), true);
  t.is(qm2.start(), true);
  t.is(qm1.start(), false);   // we would exceed the max concurrency of 1
  qm1.end();
  t.is(qm1.start(), true);
  t.is(qm1.activeCount, 1);
  t.is(qm2.activeCount, 1);
  qm2.end();
  t.is(qm2.activeCount, 0);
  qm1.end();
  t.is(qm1.activeCount, 0);
  t.is(qm1.start(), false);   // exceeded rate of 2 per 500 ms
  t.is(qm1.activeCount, 0);
  t.is(qm2.start(), true);   // exceeded rate of 2 per 500 ms
  t.is(qm2.activeCount, 1);
  qm2.end();
  t.is(qm2.activeCount, 0);
});

test('Redis quota can be updated', async t => {
  const client1: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient1: RedisClient = redis.createClient(6379, 'localhost');

  const client2: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient2: RedisClient = redis.createClient(6379, 'localhost');

  const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
  const channelName = uniqueId();
  const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client1, pubSubClient1);
  const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2, pubSubClient2);

  await Promise.all([qm1.ready, qm2.ready]);

  // each quota manager should have been assigned 2 rate units and 1 concurrency unit
  let actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, { rate: 2, interval: 500, concurrency: 1 });
  let actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, { rate: 2, interval: 500, concurrency: 1 });

  const client3: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient3: RedisClient = redis.createClient(6379, 'localhost');

  const revisedQuota: Quota = { rate: 30, interval: 1000, concurrency: 6 };
  const qm3: RedisQuotaManager = new RedisQuotaManager(revisedQuota, channelName, client3, pubSubClient3);
  await qm3.ready;

  // each quota manager should now have 10 rate units and 2 concurrency units
  actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, { rate: 10, interval: 1000, concurrency: 2 });
  actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, { rate: 10, interval: 1000, concurrency: 2 });
  let actualQuota3 = qm3.quota;
  t.deepEqual(actualQuota3, { rate: 10, interval: 1000, concurrency: 2 });

  const client4: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient4: RedisClient = redis.createClient(6379, 'localhost');

  const reRevisedQuota: Quota = { rate: 77, interval: 750 };
  const qm4: RedisQuotaManager = new RedisQuotaManager(reRevisedQuota, channelName, client4, pubSubClient4);
  await qm4.ready;

  // each quota manager should now have 19 rate units and no concurrency value
  actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, { rate: 19, interval: 750 });
  actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, { rate: 19, interval: 750 });
  actualQuota3 = qm3.quota;
  t.deepEqual(actualQuota3, { rate: 19, interval: 750 });
  let actualQuota4 = qm4.quota;
  t.deepEqual(actualQuota4, { rate: 19, interval: 750 });
});

test('Redis quota clients can expire', async t => {
  const client1: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient1: RedisClient = redis.createClient(6379, 'localhost');

  const client2: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient2: RedisClient = redis.createClient(6379, 'localhost');

  const client3: RedisClient = redis.createClient(6379, 'localhost');
  const pubSubClient3: RedisClient = redis.createClient(6379, 'localhost');

  const quota: Quota = { rate: 6, interval: 50, concurrency: 3 };
  const channelName = uniqueId();
  let qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client1, pubSubClient1, 100);
  let qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client2, pubSubClient2, 100);
  let qm3: RedisQuotaManager = new RedisQuotaManager(quota, channelName, client3, pubSubClient3, 100);

  await Promise.all([qm1.ready, qm2.ready]);

  // each quota manager should have been assigned 1/3 of the available quota
  let expectedQuota: Quota = {
    rate: Math.floor(quota.rate / 3),
    interval: quota.interval,
    concurrency: Math.floor(quota.concurrency / 3)
  };
  let actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, expectedQuota, 'client 1 has the correct quota');
  let actualQuota2 = qm2.quota;
  t.deepEqual(actualQuota2, expectedQuota, 'client 2 has the correct quota');
  let actualQuota3 = qm3.quota;
  t.deepEqual(actualQuota3, expectedQuota, 'client 3 has the correct quota');

  // remove one of them
  await qm2.unregister();
  qm2 = null;

  // force housekeeping to run
  await qm1.housekeeping();
  // wait for changes to be broadcast
  await new Promise(resolve => setTimeout(resolve, 100));

  // each remaining quota manager should now have 1/2 of the available quota
  expectedQuota = {
    rate: Math.floor(quota.rate / 2),
    interval: quota.interval,
    concurrency: Math.floor(quota.concurrency / 2)
  };
  actualQuota1 = qm1.quota;
  t.deepEqual(actualQuota1, expectedQuota, 'after housekeeping, client 1 has the correct quota');
  actualQuota3 = qm3.quota;
  t.deepEqual(actualQuota3, expectedQuota, 'after housekeeping, client 2 has the correct quota');
});
