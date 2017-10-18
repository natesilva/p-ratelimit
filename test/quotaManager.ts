import { Quota, QuotaManager } from '../src';

import test from 'ava';

test('invocations are logged', async t => {
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: QuotaManager = new QuotaManager(quota);

  t.is(qm.start(), true, 'should start job 1');
  t.is(qm.start(), true, 'should start job 2');
  t.is(qm.start(), false, 'starting job 3 would exceed max concurrency of 2');
  qm.end();
  t.is(qm.start(), true, 'should start job 3');
  t.is(qm.activeCount, 2, '2 jobs should be running');
  t.is(qm.start(), false, 'we’ve used up our quota of 3 per 1/2 second');
  t.is(qm.activeCount, 2, '2 job still running');
  qm.end();
  t.is(qm.activeCount, 1, '1 job remains running');
  t.is(qm.start(), false, 'again used up our quota of 3 per 1/2 second');
  await new Promise(resolve => setTimeout(resolve, 500));
  t.is(qm.activeCount, 1, '1 job still running');
  t.is(qm.start(), true, 'start job 4');
  t.is(qm.activeCount, 2, '2 jobs now running');
  t.is(qm.start(), false, 'starting job 5 would exceed max concurrency of 2')
  qm.end();
  t.is(qm.start(), true, 'start job 5');
  t.is(qm.activeCount, 2, '2 jobs now running');
  qm.end();
  qm.end();
  t.is(qm.activeCount, 0, 'all jobs done');
});
