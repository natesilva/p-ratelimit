import { strict as assert } from "node:assert";
import { suite, test } from "node:test";
import IORedis from "ioredis";
import { type Quota, RedisQuotaManager } from "../src/index.ts";
import type { RedisCompatibleClient } from "../src/quota/redisQuotaManager.ts";
import { sleep, uniqueId } from "../src/util.ts";
import { MockRedisBroker, MockRedisClient } from "./helpers/mock-redis-broker.ts";

// testing requires a real Redis server
// fakeredis, redis-mock, redis-js, etc. have missing or broken client.duplicate()
const REDIS_CLIENT: string = "fakeredis";
const REDIS_SERVER = "localhost";
const REDIS_PORT = 6379;

// A mock Redis "server" to use for testing
const mockRedis = new MockRedisBroker();

/**
 * Get a set of Redis clients for testing. Defaults to fakeredis to make testing possible
 * without having a live server. Set the REDIS_CLIENT const to 'ioredis' if you do have
 * a live server to test with. Set to 'cluster' if you have a cluster to test with that
 * is setup as described at:
 * https://redis.io/topics/cluster-tutorial#creating-and-using-a-redis-cluster
 */
function getRedisClients(): RedisCompatibleClient | RedisCompatibleClient[] {
  switch (REDIS_CLIENT) {
    case "ioredis":
      return new IORedis(REDIS_PORT, REDIS_SERVER);

    case "cluster": {
      const config = [
        { port: 7000, host: "localhost" },
        { port: 7001, host: "localhost" },
        { port: 7002, host: "localhost" },
        { port: 7003, host: "localhost" },
        { port: 7004, host: "localhost" },
        { port: 7005, host: "localhost" },
      ];
      return [new IORedis.Cluster(config), new IORedis.Cluster(config)];
    }

    default:
      return [
        new MockRedisClient(mockRedis) as unknown as RedisCompatibleClient,
        new MockRedisClient(mockRedis) as unknown as RedisCompatibleClient,
      ];
  }
}

/** Wait until the RQM is online */
async function waitForReady(rqm: RedisQuotaManager) {
  const expireAt = Date.now() + 5000;
  while (!rqm.ready) {
    if (Date.now() >= expireAt) {
      throw new Error("RedisQuotaManager still not ready after 5 seconds");
    }
    await sleep(100);
  }
  await sleep(100);
}

suite("redisQuotaManager", { concurrency: true }, () => {
  test("passing in a single client that doesn’t support duplicate() will throw", (_t) => {
    assert.throws(
      () => {
        const fakeClient = {} as unknown as RedisCompatibleClient;
        const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
        const _qm = new RedisQuotaManager(quota, uniqueId(), fakeClient);
      },
      { message: /client does not support the client.duplicate\(\) function/ },
    );
  });

  test("Redis quota manager works", async (_t) => {
    const clients = getRedisClients();
    const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), clients);

    await waitForReady(qm);

    assert.equal(qm.start(), true, "start job (1)");
    assert.equal(qm.start(), true, "start job (2)");
    assert.equal(qm.start(), false, "would exceed max concurrency of 2");
    qm.end();
    assert.equal(qm.start(), true, "start job (3)");
    assert.equal(qm.activeCount, 2);
    assert.equal(qm.start(), false, "would exceed quota of 3 per 1/2 second");
    qm.end();
    assert.equal(qm.activeCount, 1, "still 1 running");
    assert.equal(qm.start(), false, "still would exceed quota of 3 per 1/2 second");
    await sleep(600);
    assert.equal(qm.activeCount, 1, "still 1 running, after sleep");
    assert.equal(qm.start(), true, "start job (4)");
    assert.equal(qm.activeCount, 2, "still 2 running");
    assert.equal(qm.start(), false, "would exceed max concurrency of 2");
    qm.end();
    assert.equal(qm.start(), true, "start job (5)");
    assert.equal(qm.activeCount, 2, "still 2 running");
    qm.end();
    qm.end();
    assert.equal(qm.activeCount, 0, "none running");
  });

  test("separate Redis quota managers coordinate", async (_t) => {
    const clients1 = getRedisClients();
    const clients2 = getRedisClients();
    const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
    const channelName = uniqueId();
    const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients1);
    const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients2);

    await Promise.all([waitForReady(qm1), waitForReady(qm2)]);

    // each quota manager should have been assigned 1/2 of the available quota
    assert(quota.rate);
    assert(quota.concurrency);
    const expectedQuota: Quota = {
      interval: quota.interval,
      rate: Math.floor(quota.rate / 2),
      concurrency: Math.floor(quota.concurrency / 2),
    };

    const actualQuota1 = qm1.quota;
    assert.deepEqual(actualQuota1, expectedQuota, "client 1 has the correct quota");
    const actualQuota2 = qm2.quota;
    assert.deepEqual(actualQuota2, expectedQuota, "client 2 has the correct quota");
  });

  test("Redis quota can be updated", async (_t) => {
    const clients1 = getRedisClients();
    const clients2 = getRedisClients();

    const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };
    const channelName = uniqueId();
    const qm1: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients1);
    const qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients2);

    await Promise.all([waitForReady(qm1), waitForReady(qm2)]);

    // each quota manager should have been assigned 1/2 the overall quota
    let expectedQuota = Object.assign({}, quota);
    assert(expectedQuota.rate);
    assert(expectedQuota.concurrency);
    expectedQuota.rate = Math.floor(expectedQuota.rate / 2);
    expectedQuota.concurrency = Math.floor(expectedQuota.concurrency / 2);
    let actualQuota1 = qm1.quota;
    assert.deepEqual(actualQuota1, expectedQuota, "client 1 quota should be correct");
    let actualQuota2 = qm2.quota;
    assert.deepEqual(actualQuota2, expectedQuota, "client 2 quota should be correct");

    const clients3 = getRedisClients();
    const qm3: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients3);
    await waitForReady(qm3);

    // each quota manager should now have 1/3 the overall quota
    expectedQuota = Object.assign({}, quota);
    assert(expectedQuota.rate);
    assert(expectedQuota.concurrency);
    expectedQuota.rate = Math.floor(expectedQuota.rate / 3);
    expectedQuota.concurrency = Math.floor(expectedQuota.concurrency / 3);
    actualQuota1 = qm1.quota;
    assert.deepEqual(actualQuota1, expectedQuota, "client 1 quota should be updated");
    actualQuota2 = qm2.quota;
    assert.deepEqual(actualQuota2, expectedQuota, "client 2 quota should be updated");
    const actualQuota3 = qm3.quota;
    assert.deepEqual(actualQuota3, expectedQuota, "client 3 quota should be updated");
  });

  test("RedisQuotaManager has a zero concurrency quota before it’s ready", async (_t) => {
    const clients = getRedisClients();
    const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), clients);

    assert.equal(qm.quota.concurrency, 0);
    await waitForReady(qm);
    assert.equal(qm.quota.concurrency, 2);
  });

  test("RedisQuotaManager with undefined concurrency has zero concurrency before it’s ready", async (_t) => {
    const clients = getRedisClients();
    const quota: Quota = { rate: 3, interval: 500 };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), clients);

    assert.equal(qm.quota.concurrency, 0);
    await waitForReady(qm);
    assert.equal(qm.quota.concurrency, undefined);
  });

  test("maxDelay applies to RedisQuotaManager even before it’s ready", async (_t) => {
    const clients = getRedisClients();
    const quota: Quota = {
      rate: 3,
      interval: 500,
      concurrency: 2,
      maxDelay: 250,
    };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, uniqueId(), clients);

    assert.equal(qm.quota.maxDelay, 250);
    await waitForReady(qm);
    assert.equal(qm.quota.maxDelay, 250);
  });

  test("RedisQuotaManager with fastStart = true will process requests right away", async (_t) => {
    const channelName = uniqueId();

    const clients = getRedisClients();
    const quota: Quota = {
      rate: 10,
      interval: 500,
      concurrency: 4,
      fastStart: true,
    };
    const qm: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients);

    const clients2 = getRedisClients();
    const _qm2: RedisQuotaManager = new RedisQuotaManager(quota, channelName, clients2);

    assert.equal(
      qm.quota.concurrency,
      quota.concurrency,
      "starts with full concurrency quota",
    );
    assert.equal(qm.quota.rate, quota.rate, "starts with full rate quota");
    assert.equal(qm.ready, true, "it’s ready immediately");
    // wait for peer discovery
    await sleep(3000);
    assert(quota.concurrency);
    assert(quota.rate);
    assert.equal(
      qm.quota.concurrency,
      Math.floor(quota.concurrency / 2),
      "now has half the concurrency quota",
    );
    assert.equal(
      qm.quota.rate,
      Math.floor(quota.rate / 2),
      "now has half the rate quota",
    );
  });

  test("destroy stops heartbeats and unsubscribes from channel", async (_t) => {
    const channelName = uniqueId();
    const quota: Quota = { rate: 4, interval: 500, concurrency: 2 };

    const clients1 = getRedisClients();
    const qm1 = new RedisQuotaManager(quota, channelName, clients1, 100);
    await waitForReady(qm1);

    const clients2 = getRedisClients();
    const qm2 = new RedisQuotaManager(quota, channelName, clients2, 100);
    await waitForReady(qm2);

    // Both should have half the quota
    assert.equal(qm1.quota.rate, 2, "qm1 starts with half rate");
    assert.equal(qm2.quota.rate, 2, "qm2 starts with half rate");

    // Destroy qm1
    await qm1.destroy();

    // Wait long enough for qm2 to consider qm1 expired (heartbeatInterval * 3 + buffer)
    await sleep(500);

    // qm2 should now reclaim the full quota since qm1 is gone
    assert.equal(qm2.quota.rate, 4, "qm2 reclaims full rate after qm1 destroyed");
    assert.equal(
      qm2.quota.concurrency,
      2,
      "qm2 reclaims full concurrency after qm1 destroyed",
    );
  });
});
