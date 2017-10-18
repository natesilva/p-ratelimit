import { Dequeue } from '../src/dequeue';
import test from 'ava';

test('dequeue basic functionality', t => {
  const d = new Dequeue<string>();
  t.is(d.length, 0);
  d.push('foo');                  //  [ foo ]
  d.push('bar');                  //  [ foo, bar ]
  t.is(d.length, 2);
  t.is(d.peekFront(), 'foo');
  t.is(d.peekBack(), 'bar');
  t.is(d.shift(), 'foo');         // [ bar ]
  d.push('baz');                  // [ bar, baz ]
  t.is(d.pop(), 'baz');           // [ bar ]
  t.is(d.pop(), 'bar');           // [ ]
  t.is(d.length, 0);
});

test('dequeue large size, unshift in, shift out', async t => {
  const TEST_SIZE = 1000000;

  let d = new Dequeue<number>();
  for (let i = 0; i < TEST_SIZE; ++i) {
    d.unshift(i);
  }
  t.is(d.length, TEST_SIZE);

  for (let i = 0; i < TEST_SIZE / 2; ++i) {
    d.shift();
  }

  t.is(d.length, TEST_SIZE - TEST_SIZE / 2);

  while (d.length) {
    d.shift();
  }

  t.is(d.length, 0);
});

test('dequeue large size, push in, pop out', t => {
  const TEST_SIZE = 1000000;

  const d = new Dequeue<number>();
  for (let i = 0; i < TEST_SIZE; ++i) {
    d.push(i);
  }
  t.is(d.length, TEST_SIZE);

  for (let i = 0; i < TEST_SIZE / 2; ++i) {
    d.pop();
  }

  t.is(d.length, TEST_SIZE - TEST_SIZE / 2);

  while (d.length) {
    d.pop();
  }

  t.is(d.length, 0);
});
