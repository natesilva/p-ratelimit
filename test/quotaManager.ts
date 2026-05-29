import { strict as assert } from "node:assert";
import { suite, test } from "node:test";
import { type Quota, QuotaManager } from "../src/index.ts";

suite("quotaManager", { concurrency: true }, () => {
  test("invocations are logged", async (_t) => {
    const quota: Quota = { rate: 3, interval: 500, concurrency: 2 };
    const qm: QuotaManager = new QuotaManager(quota);

    assert.equal(qm.start(), true, "should start job 1");
    assert.equal(qm.start(), true, "should start job 2");
    assert.equal(qm.start(), false, "starting job 3 would exceed max concurrency of 2");
    qm.end();
    assert.equal(qm.start(), true, "should start job 3");
    assert.equal(qm.activeCount, 2, "2 jobs should be running");
    assert.equal(qm.start(), false, "we’ve used up our quota of 3 per 1/2 second");
    assert.equal(qm.activeCount, 2, "2 jobs still running");
    qm.end();
    assert.equal(qm.activeCount, 1, "1 job remains running");
    qm.end();
    assert.equal(qm.activeCount, 0, "all jobs done");
  });

  test("throws if an incomplete rate-limit quota is used", (_t) => {
    assert.throws(() => new QuotaManager({ interval: 100 }), {
      message: /Invalid Quota/,
    });
    assert.throws(() => new QuotaManager({ rate: 42 }), { message: /Invalid Quota/ });
  });
});
