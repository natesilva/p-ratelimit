import * as crypto from 'crypto';

export function uniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
