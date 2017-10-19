import { getRandomInt, promisify, uniqueId } from '../util';

import { Quota } from './quota';
import { QuotaManager } from './quotaManager';
import { RedisClient } from 'redis';

/**
 * Coordinates rate limits across servers by storing the queue configuration in Redis and
 * delegating a portion of our rate limits to each registered client.
 */
export class RedisQuotaManager extends QuotaManager {
  public readonly uniqueId = uniqueId();
  private _ready = false;
  private heartbeatTimer: any = null;
  private readonly pubSubClient: RedisClient;
  private clientPings = new Map<string, number>();

  /**
   * @param channelQuota the overall quota to be shared among all clients
   * @param quotaName unique name for this quota - used as a Redis pub/sub channel name
   * @param client a Redis client
   */
  constructor(
    private channelQuota: Quota,
    private readonly quotaName: string,
    private readonly client: RedisClient
  ) {
    // Start with a zero quota; this will be updated when we get our first QUOTA message
    super({ interval: 1000, rate: 0, concurrency: 0 });
    this.clientPings.set(this.uniqueId, Date.now());
    this.pubSubClient = this.client.duplicate();
    this.register();
  }

  /** Join the client pool, coordinated by the shared channel on Redis */
  private async register() {
    this.pubSubClient.on('message', (channel, message) => this.message(channel, message));
    await promisify(this.pubSubClient.subscribe.bind(this.pubSubClient))(this.quotaName);
    await this.sendMessage('PING', this.uniqueId);
    await new Promise(resolve => setTimeout(resolve, 3000));
    await this.sendMessage('QUOTA', this.channelQuota);
    this.heartbeatTimer = setInterval(this.heartbeat.bind(this), 30000);
  }

  /** Disconnect from the client pool */
  public async unregister() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await promisify(this.pubSubClient.unsubscribe.bind(this.pubSubClient))();
    await this.sendMessage('BYE', this.uniqueId);
    this._quota = { interval: 1000, rate: 0, concurrency: 0 };
  }

  /** Send a message to the shared Redis channel */
  private sendMessage(command: string, value: any) {
    return promisify(this.client.publish.bind(this.client))(
      this.quotaName,
      JSON.stringify({ command, value })
    );
  }

  /** Receive client pings and quota update messages */
  private message(channel: string, message: any) {
    let parsedMessage: { command: string, value: any };
    try {
      parsedMessage = JSON.parse(message);
    } catch {
      const msg = `invalid JSON on Redis pub/sub channel ${channel}: ${message}`;
      console.error(msg);
    }

    const { command, value } = parsedMessage;

    switch (command) {
      case 'PING':
        if (this.clientPings.has(value)) {
          this.clientPings.set(value, Date.now());
        } else {
          this.clientPings.set(value, Date.now());
          this.updateQuota();
          if (value !== this.uniqueId) { this.sendMessage('PING', this.uniqueId); }
        }
        break;

      case 'BYE':
        this.clientPings.delete(value);
        this.updateQuota();
        break;

      case 'QUOTA':
        this.channelQuota = value;
        this.updateQuota();
        this._ready = true;
        break;
    }
  }

  /** Calculate our quota -- our portion of the overall channel quota */
  private updateQuota() {
    const expired = Date.now() - 90000;
    for (const [k, v] of this.clientPings) {
      if (v <= expired) { this.clientPings.delete(k); }
    }

    if (!this.clientPings.size) { return; }

    const newQuota = Object.assign({}, this.channelQuota);
    newQuota.rate = Math.floor(newQuota.rate / this.clientPings.size);
    if (newQuota.concurrency) {
      newQuota.concurrency = Math.floor(newQuota.concurrency / this.clientPings.size);
    }

    this._quota = newQuota;
  }

  /** Let the others know we’re here */
  private heartbeat() {
    this.sendMessage('PING', this.uniqueId);
  }

  /**
   * Promise that returns true when this queue manager is ready to use. Used by the unit
   * tests. Requests are queued so there’s no reason to use it in normal code.
   * @returns true when the connection is ready
   * @throws if the connection is not ready within 5 seconds
   */
  public get ready() {
    return new Promise<boolean>((resolve, reject) => {
      const timerId = setInterval(() => {
        if (this._ready) {
          clearInterval(timerId);
          resolve(true);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(timerId);
        if (this._ready) {
          resolve(true);
        } else {
          const msg = 'Redis connection for rate limiting quota manager is not ready';
          reject(new Error(msg));
        }
      }, 5000);
    });
  }
}
