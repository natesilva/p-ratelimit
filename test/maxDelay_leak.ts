
import test from 'ava';
import { Quota } from '../src/quota/quota';
import { QuotaManager } from '../src/quota/quotaManager';
import { pRateLimit } from '../src/rateLimit';
import { sleep } from '../src/util';

test('maxDelay timeout should not leak concurrency slots', async t => {
    const quota: Quota = {
        concurrency: 1,
        maxDelay: 100 // 100ms max delay
    };
    const quotaManager = new QuotaManager(quota);
    const rateLimit = pRateLimit(quotaManager);

    // Task 1: Slow task, takes 500ms
    const task1 = rateLimit(async () => {
        await sleep(500);
        return 'task1';
    });

    // Task 2: Should timeout because Task 1 takes 500ms and maxDelay is 100ms
    const task2 = rateLimit(async () => {
        return 'task2';
    });

    // Task 2 should fail
    await t.throwsAsync(task2, { message: /timeout/ });

    // Wait for Task 1 to finish
    await task1;

    // Wait a bit more to ensure Task 2's "run" function has been processed by the queue
    // Task 2's run function is still in the queue when it times out.
    // It gets processed when Task 1 finishes and calls next().
    await sleep(100);

    // Now activeCount should be 0.
    // If the bug exists, activeCount will be 1 because Task 2's run function called start() but not end().
    t.is(quotaManager.activeCount, 0, 'activeCount should be 0 after tasks finish');

    if (quotaManager.activeCount !== 0) {
        return; // Stop test to avoid timeout
    }

    // Task 3: Should run immediately
    const task3 = rateLimit(async () => {
        return 'task3';
    });

    // If activeCount is leaked (is 1), Task 3 will be queued.
    // Since concurrency is 1, and we think 1 is active, Task 3 waits.
    // But nothing is actually running, so it waits forever (or until maxDelay).
    // We expect it to finish quickly.
    await t.notThrowsAsync(task3);
});
