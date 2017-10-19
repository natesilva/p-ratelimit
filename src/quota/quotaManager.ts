import { Dequeue } from '../dequeue';
import { Quota } from './quota';

/** keep track of API invocations, allowing or disallowing them based on our quota */
export class QuotaManager {
  protected _activeCount = 0;
  protected history = new Dequeue()

  constructor(protected _quota: Quota) {}

  /** The current quota */
  get quota() { return Object.assign({}, this._quota); }

  /** The number of currently-active invocations */
  get activeCount() { return this._activeCount; }

  /**
   * Log that an invocation started.
   * @returns true if the invocation was allowed, false if not (you can try again later)
   */
  start() {
    if (this._activeCount >= this._quota.concurrency) { return false; }

    if (this._quota.interval !== undefined && this._quota.rate !== undefined) {
      this.removeExpired();
      if (this.history.length >= this._quota.rate) { return false; }
      this.history.push(Date.now());
    }

    this._activeCount++;
    return true;
  }

  /** Log that an invocation ended */
  end() {
    this._activeCount--;
  }

  protected removeExpired() {
    const expired = Date.now() - this._quota.interval;
    while (this.history.peekFront() < expired) {
      this.history.shift();
    }
  }
}
