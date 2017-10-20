import { sleep } from './util';

function mockApi(sleepTime: number, reject = false) {
  const fn = () => {
    fn['runCount']++;
    if (reject) {
      fn['rejectCount']++;
      throw new Error('mockApi rejected');
    }
    fn['fulfillCount']++;
    return sleep(sleepTime);
  };

  fn['runCount'] = 0;
  fn['rejectCount'] = 0;
  fn['fulfillCount'] = 0;

  return fn;
}

async function main() {
  const f = mockApi(100);
  const g = mockApi(100);
  f();
  f();
  f();
  g();
  f();
  console.log(f['runCount'], f['rejectCount'], f['fulfillCount']);
  console.log(g['runCount'], g['rejectCount'], g['fulfillCount']);
}

main();
