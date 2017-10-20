import * as crypto from 'crypto';

export function uniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

export function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function promisify(fn) {
  return function(...args) {
    return new Promise<any>((resolve, reject) => {
      fn.apply(null, args.concat((err, ...results) => {
        if (err) { reject(err); }
        else { resolve.apply(null, results); }
      }))
    });
  }
}
