import { sleep } from './util';
function fn() {
  return new Promise((resolve, reject) => {
    reject(new Error('immediate reject'));
    setTimeout(() => {
      console.log('>>> CHECKPOINT A1');
      resolve(42);
      console.log('>>> CHECKPOINT A2');
    }, 500);
  });
}

async function main() {
  try {
    await fn();
  } catch (err) {
    console.error(err);
  }

  await sleep(1000);
  console.log('>>> CHECKPOINT B');
}

main();
