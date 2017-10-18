import { Dequeue } from './dequeue';
import { Quota } from './storage/quota';
import { QuotaManager } from './storage/quotaManager';

export function pRateLimit(quotaManager: QuotaManager | Quota)
  : <T>(fn: () => Promise<T>) => Promise<T>
{
  if (!(quotaManager instanceof QuotaManager)) {
    return pRateLimit(new QuotaManager(quotaManager));
  }

  const queue = new Dequeue<Function>();
  let timerId: NodeJS.Timer = null;

  const next = () => {
    while (queue.length && quotaManager.start()) {
      queue.shift()();
    }

    if (queue.length && !quotaManager.activeCount && !timerId) {
      timerId = setTimeout(() => {
        timerId = null;
        next();
      }, 100);
    }
  };

  return <T>(fn: () => Promise<T>) => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn()
          .then(val => {
            quotaManager.end();
            resolve(val);
            next();
          })
          .catch(err => {
            quotaManager.end();
            reject(err);
            next();
          })
        ;
      };

      queue.push(run);
      next();
    });
  };
}
