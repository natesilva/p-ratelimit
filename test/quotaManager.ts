import { Quota, QuotaManager } from '../src';

import test from 'ava';

test('invocations are logged', async t => {
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: QuotaManager = new QuotaManager(quota);

  t.is(qm.start(), true);
  t.is(qm.start(), true);
  t.is(qm.start(), false);   // we would exceed the max concurrency of 2
  qm.end();
  t.is(qm.start(), true);
  t.is(qm.activeCount, 2);
  t.is(qm.start(), false);   // we’ve used up our quota of 3 per 1/2 second
  t.is(qm.activeCount, 2);
  qm.end();
  t.is(qm.activeCount, 1);
  t.is(qm.start(), false);   // we’ve used up our quota of 3 per 1/2 second
  await new Promise(resolve => setTimeout(resolve, 500));
  t.is(qm.activeCount, 1);
  t.is(qm.start(), true);
  t.is(qm.activeCount, 2);
  t.is(qm.start(), false);   // we would exceed the max concurrency of 2
  qm.end();
  t.is(qm.start(), true);
  t.is(qm.activeCount, 2);
  qm.end();
  qm.end();
  t.is(qm.activeCount, 0);
});
