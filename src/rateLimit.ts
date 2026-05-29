import { strict as assert } from "node:assert";
import { Dequeue } from "./dequeue.ts";
import type { Quota } from "./quota/quota.ts";
import { QuotaManager } from "./quota/quotaManager.ts";
import { RateLimitTimeoutError } from "./rateLimitTimeoutError.ts";

export function pRateLimit(
  quotaManager: QuotaManager | Quota,
): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!(quotaManager instanceof QuotaManager)) {
    return pRateLimit(new QuotaManager(quotaManager));
  }

  const queue = new Dequeue<() => void>();
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const next = () => {
    while (queue.length && quotaManager.start()) {
      const fn = queue.shift();
      assert(fn);
      fn();
    }

    if (queue.length && !quotaManager.activeCount && !timerId) {
      timerId = setTimeout(() => {
        timerId = undefined;
        next();
      }, 100);
    }
  };

  return <T>(fn: () => Promise<T>) => {
    return new Promise<T>((resolve, reject) => {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      if (quotaManager.maxDelay) {
        timerId = setTimeout(() => {
          timerId = undefined;
          reject(new RateLimitTimeoutError("queue maxDelay timeout exceeded"));
          next();
        }, quotaManager.maxDelay);
      }

      const run = () => {
        if (quotaManager.maxDelay) {
          if (timerId) {
            clearTimeout(timerId);
          } else {
            // timeout already fired
            return;
          }
        }

        fn()
          .then((val) => {
            quotaManager.end();
            resolve(val);
          })
          .catch((err) => {
            quotaManager.end();
            reject(err);
          })
          .then(() => {
            next();
          });
      };

      queue.push(run);
      next();
    });
  };
}
