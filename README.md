# p-ratelimit

Promise-based utility to make sure you don’t call rate-limited APIs too quickly.

This can throttle any function that returns a Promise.

## What’s different

* **True rate limiting**
    * Utilities like [p-limit](https://github.com/sindresorhus/p-limit) control how many functions are running concurrently. That won’t prevent you from exceeding limits on APIs that use token-bucket throttling.
    * **p-ratelimit** supports both concurrency and rate limits.
* **Works across API families**
    * Utilities like [Lodash throttle](https://lodash.com/docs#throttle) create separate quotas for each API function.
    * **p-ratelimit** can enforce a single shared quota for all functions in an API family.
* **Distributed rate limits**
    * If you use Redis, **p-ratelimit** supports efficient rate limiting across multiple hosts. The available quota is divided among your pool of servers. As servers are added or removed, the shared quota is recaclulated.
* **Designed for Promises and TypeScript friendly**
    * A rate-limited function returns the same Promise type as the original function.


## Example

```javascript
const { pRateLimit } = require('p-ratelimit');
// import { pRateLimit } from 'p-ratelimit';       // TypeScript

// create a rate limiter that allows up to 30 API calls per second,
// with max concurrency of 10
const rateLimiter = pRateLimit({ rate: 30, interval: 1000, concurrency: 10 });

async function main() {
  // original WITHOUT rate limiter:
  result = await someApi.someFunction(42);
  // with rate limiter:
  result = await rateLimiter(() => someApi.someFunction(42));
}

main();
```

## Redis

You can optionally use Redis to coordinate rate limits among a pool of servers.

```javascript
const { pRateLimit, RedisQuotaManager } = require('p-ratelimit');

// make sure this is the same across all servers that share this rate limit quota
const apiFamilyName = 'my-api-family';

// because we use Redis pub/sub we need two Redis client instances
const client = redis.createClient(6379, 'your-redis-server');
const pubSubClient = redis.createClient(6379, 'your-redis-server');

const quota = { rate: 100, interval: 1000, concurrency: 50 };
const qm = new RedisQuotaManager(quota, apiFamilyName, client, pubSubClient);
const rateLimiter = pRateLimit(qm);

// Each server that registers with this apiFamilyName will be allotted
// 1/(number of servers) of the available quota. If a new server joins, the quota will
// be divided further and each server will be notified via Redis pub/sub. If a server goes
// away, its quota will be reallocated among the remaining servers within a few minutes.

// now use rateLimiter(…) as usual
```
