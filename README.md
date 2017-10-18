# p-ratelimit

Promise-based utility to make sure you don’t call rate-limited APIs too quickly.

This can throttle any function that returns a Promise.

## What’s different

There are many throttling utilities available. Here’s what’s different about this one:

* Rate limiting, not only concurrency
    * Utilities like [p-limit](https://github.com/sindresorhus/p-limit) control how many functions are running concurrently. That won’t prevent you from exceeding limits on APIs that use token-bucket throttling.
    * **p-ratelimit** supports both concurrency and rate limits.
* Distributed rate limits
    * If you use Redis, **p-ratelimit** supports efficient rate limiting across multiple hosts. The available quota is divided among your pool of servers. As servers are removed or added, the quota is recaclulated, so that all servers, combined, do not exceed the limits.
* Designed for Promises and TypeScript friendly
    * The rate-limited function returns the same Promise type as the original function.
* Works across entire API families
    * A single limit can be applied in aggregate across a family of APIs.
    * Not limited to individual quotas for each API function.


## Example

```javascript
const { createRateLimiter } = require('p-ratelimit');
// import { createRateLimiter } from 'p-ratelimit';       // TypeScript

// create a rate limiter that allows up to 30 API calls per second
const rateLimiter = createRateLimiter({ rate: 30, interval: 1000 });

async function main() {
  // original WITHOUT rate limiter:
  var result = await someApi.someFunction();
  // WITH rate limiter, returns a Promise:
  result = await rateLimiter(someApi.someFunction);

  // how to call an API function that takes an argument

  // original WITHOUT rate limiter:
  result = await someApi.someFunction(42);
  // WITH rate limiter:
  result = await rateLimiter(() => someApi.someFunction(42));
}

main();
```
