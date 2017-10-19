# p-ratelimit [![npm](https://img.shields.io/npm/v/p-ratelimit.svg)](https://www.npmjs.com/package/p-ratelimit) [![dependencies](https://img.shields.io/david/natesilva/p-ratelimit.svg)](https://www.npmjs.com/package/p-ratelimit) [![license](https://img.shields.io/github/license/natesilva/p-ratelimit.svg)](https://github.com/natesilva/p-ratelimit/blob/master/LICENSE) [![node](https://img.shields.io/node/v/p-ratelimit.svg)](https://www.npmjs.com/package/p-ratelimit)

> Makes sure you don’t call rate-limited APIs too quickly.

This works with any API function that returns a Promise. If your API uses callbacks instead of Promises, you could [promisify](https://nodejs.org/api/util.html#util_util_promisify_original) it.

## Install

```
$ npm i p-ratelimit
```

## What’s different

* **True rate limiting**
    * Utilities like [p-limit](https://github.com/sindresorhus/p-limit) control how many functions are running concurrently. That won’t prevent you from exceeding limits on APIs that use token-bucket throttling.
    * **p-ratelimit** supports both concurrency and rate limits.
* **Works across API families**
    * Utilities like [Lodash throttle](https://lodash.com/docs#throttle) create separate quotas for each API function.
    * **p-ratelimit** can enforce a single shared quota for all functions in an API family.
* **Distributed rate limits**
    * If you use Redis, **p-ratelimit** supports efficient rate limiting across multiple hosts. The available quota is divided among your pool of servers. As servers are added or removed, the shared quota is recaclulated.
* **Made for Promises and TypeScript friendly**
    * A rate-limited function returns the same Promise type as the original function.

## Example

```javascript
const { pRateLimit } = require('p-ratelimit');
// import { pRateLimit } from 'p-ratelimit';       // TypeScript

// create a rate limiter that allows up to 30 API calls per second,
// with max concurrency of 10
const limit = pRateLimit({
    interval: 1000,             // 1000 ms == 1 second
    rate: 30,                   // 30 API calls per interval
    concurrency: 10,            // no more than 10 running at once
});

async function main() {
  // original WITHOUT rate limiter:
  result = await someFunction(42);
  // with rate limiter:
  result = await limit(() => someFunction(42));
}

main();
```

## Distributed rate limits

You can use Redis to coordinate a rate limit among a pool of servers.

```javascript
const { pRateLimit, RedisQuotaManager } = require('p-ratelimit');

// These must be the same across all servers that share this quota:
const channelName = 'my-api-family';
const quota = { rate: 100, interval: 1000, concurrency: 50 };

// Create a RedisQuotaManager
const qm = new RedisQuotaManager(
    quota,
    channelName,
    redisClient
);

// Create a rate limiter that uses the RedisQuotaManager
const limit = pRateLimit(qm);

// now use limit(…) as usual
```

Each server that registers with a given `channelName` will be allotted `1/(number of servers)` of the available quota. For example, if the pool consists of four servers, each will receive 1/4 the available quota.

When a new server joins the pool, the quota is dynamically adjusted. If a server goes away, its quota is reallocated among the remaining servers within a few minutes.

## License

MIT © Nate Silva
