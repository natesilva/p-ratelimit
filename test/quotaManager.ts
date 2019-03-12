import { Quota, QuotaManager } from '../src';

import { sleep } from '../src/util';
import test from 'ava';

test('invocations are logged', async t => {
  const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
  const qm: QuotaManager = new QuotaManager(quota);

  t.true(qm.start(), 'should start job 1');
  t.true(qm.start(), 'should start job 2');
  t.false(qm.start(), 'starting job 3 would exceed max concurrency of 2');
  qm.end();
  t.true(qm.start(), 'should start job 3');
  t.is(qm.activeCount, 2, '2 jobs should be running');
  t.false(qm.start(), 'we’ve used up our quota of 3 per 1/2 second');
  t.is(qm.activeCount, 2, '2 jobs still running');
  qm.end();
  t.is(qm.activeCount, 1, '1 job remains running');
  qm.end();
  t.is(qm.activeCount, 0, 'all jobs done');
});

test('throws if an incomplete rate-limit quota is used', t => {
  t.throws(() => new QuotaManager({ interval: 100 }), /Invalid Quota/);
  t.throws(() => new QuotaManager({ rate: 42 }), /Invalid Quota/);
});
