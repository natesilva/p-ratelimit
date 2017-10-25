# Using Redis with `p-ratelimit`

Using Redis with `p-ratelimit` is optional.

If you use Redis, `p-ratelimit` can coordinate rate limit quotas across multiple servers, so that all of your servers, combined, do not go over your assigned quota.

## Basic usage

To use Redis, you need to:

1. Decide on a channel name.
2. Create a `RedisQuotaManager`.
3. Create a rate limiter, passing it the `RedisQuotaManager`.

### 1. Decide on a channel name

This will be used as the name of a Redis pub/sub channel. All servers that share a quota must use the same channel name.

### 2. Create a RedisQuotaManager

Construct it by passing in a `Quota`, the channel name, and an initialized Redis client.

> ⚠️  — **Special case:** If your Redis client doesn’t support the `client.duplicate()` function, you’ll need to pass an array of **two** initialized Redis clients. Standard Redis clients do support the `duplicate` function. But if you are using Redis Cluster, or `fakeredis`, or another specialty Redis client, you’ll need to initialize and provide two clients.

### 3. Create a rate limiter

Instead of passing a `Quota`, pass the `RedisQuotaManager` to it.

#### Example

```typescript
const channelName = 'my-channel';
const quota = { concurrency: 10, interval: 1000, rate: 50, fastStart: true };
const quotaManager = new RedisQuotaManager(quota, channelName, redisClient);
const rateLimiter = pRateLimit(quotaManager);
```

## How it works

For performance reasons, each rate limiter operates independently. No state is stored in Redis. Redis is only used as a pub/sub channel to discover peers.

Upon startup, a rate limiter pings the pub/sub channel with its own unique id. Each peer rate limiter notices that a new server has come online and replies with its own ping. Ping replies are only sent if a new, previously unknown, server is discovered. This minimizes the amount of network traffic and prevents ping storms.

In this way, each server becomes aware of its peers.

As a server discovers new peers, it recalculates its quota to be `Math.floor(1 / number of peers)` of the overall `concurrency` and `rate` quotas.

### Reclaiming quota from servers that go offline

If a server goes offline, the remaining servers decrement their count of known peers and recalculate the quota.

To do this, each server periodically sends an unsolicited ping (default: every 30 seconds). Peer servers keep track of the last time each server was seen.

If a server has not been seen for 3 consecutive ping periods (90 seconds), the other servers reclaim its quota.

## The `fastStart` option

If the `Quota` has `fastStart` set to `true`, the rate-limiter will immediately process API requests, up to the full quota. As peer servers are discovered, the quota is automatically adjusted downward.

If `fastStart` is `false` (the default), the rate-limiter starts with a quota of `0`. All API requests are queued and no requests are processed yet. After several seconds, when the rate-limiter has discovered its peers, its true quota is calculated and it begins processing the queued requests.

A `fastStart` value of `true` will begin processing requests immediately, but there’s a small chance it could briefly cause the shared rate limit to be exceeded. A value of `false` makes sure the limit is not exceeded, but your app may run slowly at first, as the first API calls may be delayed for a few seconds.
