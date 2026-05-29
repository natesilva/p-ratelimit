import { strict as assert } from "node:assert";
import { suite, test } from "node:test";
import { Dequeue } from "../src/dequeue.ts";

suite("deque", { concurrency: true }, () => {
  test("basic functionality", (_t) => {
    const d = new Dequeue<string>();
    assert.equal(d.length, 0);
    d.push("foo"); //  [ foo ]
    d.push("bar"); //  [ foo, bar ]
    assert.equal(d.length, 2);
    assert.equal(d.peekFront(), "foo");
    assert.equal(d.peekBack(), "bar");
    assert.equal(d.shift(), "foo"); // [ bar ]
    d.push("baz"); // [ bar, baz ]
    assert.equal(d.pop(), "baz"); // [ bar ]
    assert.equal(d.pop(), "bar"); // [ ]
    assert.equal(d.length, 0);
  });

  test("large size, unshift in, shift out", async (_t) => {
    const TEST_SIZE = 1000000;

    const d = new Dequeue<number>();
    for (let i = 0; i < TEST_SIZE; ++i) {
      d.unshift(i);
    }
    assert.equal(d.length, TEST_SIZE);

    for (let i = 0; i < TEST_SIZE / 2; ++i) {
      d.shift();
    }

    assert.equal(d.length, TEST_SIZE - TEST_SIZE / 2);

    while (d.length) {
      d.shift();
    }

    assert.equal(d.length, 0);
  });

  test("large size, push in, pop out", (_t) => {
    const TEST_SIZE = 1000000;

    const d = new Dequeue<number>();
    for (let i = 0; i < TEST_SIZE; ++i) {
      d.push(i);
    }
    assert.equal(d.length, TEST_SIZE);

    for (let i = 0; i < TEST_SIZE / 2; ++i) {
      d.pop();
    }

    assert.equal(d.length, TEST_SIZE - TEST_SIZE / 2);

    while (d.length) {
      d.pop();
    }

    assert.equal(d.length, 0);
  });

  test("if empty, head and tail return undefined", (_t) => {
    const d = new Dequeue();
    assert.equal(d.length, 0);
    assert.equal(d.peekFront(), undefined);
    assert.equal(d.peekBack(), undefined);
    assert.equal(d.shift(), undefined);
    assert.equal(d.pop(), undefined);
  });

  test("clear the dequeue", (_t) => {
    const d = new Dequeue();
    d.push("foo");
    d.push("bar");
    assert.ok(d.length > 0);
    d.clear();
    assert.ok(d.length === 0);
    assert.equal(d.peekFront(), undefined);
    assert.equal(d.peekBack(), undefined);
  });
});
