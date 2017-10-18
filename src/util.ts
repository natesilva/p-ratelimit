import * as crypto from 'crypto';

export function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

export function promisify(fn) {
  return function(...args) {
    return new Promise<any>((resolve, reject) => {
      fn.apply(null, args.concat((err, ...results) => {
        if (err) { reject(err); }
        else { resolve.apply(null, results); }
      }));
    });
  };
}

export function uniqueId() {
  const buf = Buffer.alloc(16);
  return crypto.randomFillSync(buf).toString('hex');
}
