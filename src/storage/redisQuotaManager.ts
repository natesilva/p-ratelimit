import { getRandomInt, promisify, uniqueId } from '../util';

import { Quota } from './quota';
import { QuotaManager } from './quotaManager';
import { RedisClient } from 'redis';

const HEARTBEAT_INTERVAL = 30000;

/**
 * Coordinates rate limits across servers by storing the queue configuration in Redis and
 * delegating a portion of our rate limits to each registered client.
 */
export class RedisQuotaManager extends QuotaManager {
  public readonly uniqueId = uniqueId();
  private readonly pubSubClient: RedisClient;
  private readonly clientPings = new Map<string, number>();
  private _ready = false;
  private heartbeatTimer: any = null;

  /**
   * @param channelQuota the overall quota to be split among all clients
   * @param channelName unique name for this quota - the Redis pub/sub channel name
   * @param client a Redis client
   */
  constructor(
    private channelQuota: Quota,
    private readonly channelName: string,
    private readonly client: RedisClient
  ) {
    super({ interval: 1000, rate: 0, concurrency: 0 });
    this.pubSubClient = this.client.duplicate();
    this.clientPings.set(this.uniqueId, Date.now());
    this.register();
  }

  /** Join the client pool, coordinated by the shared channel on Redis */
  private async register() {
    this.pubSubClient.on('message', (channel, message) => this.message(channel, message));
    await promisify(this.pubSubClient.subscribe.bind(this.pubSubClient))(this.channelName);
    await this.sendMessage('JOIN', { id: this.uniqueId, quota: this.channelQuota });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await this.updateQuota();
    this._ready = true;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
  }

  /** Disconnect from the client pool */
  public async unregister() {
    clearInterval(this.heartbeatTimer);
    await promisify(this.pubSubClient.unsubscribe.bind(this.pubSubClient))();
    this.sendMessage('LEAVE', this.uniqueId);
    this._quota = { interval: 1000, rate: 0, concurrency: 0 };
  }

  /** Send a message to the shared Redis channel */
  private sendMessage(command: string, value: any) {
    const publish = promisify(this.client.publish.bind(this.client));
    return publish(this.channelName, JSON.stringify({ command, value }));
  }

  /** Receive client pings and join/leave messages */
  private message(channel: string, message: any) {
    let parsedMessage: { command: string, value: any };
    try {
      parsedMessage = JSON.parse(message);
    } catch {
      console.error(`invalid JSON on Redis pub/sub channel ${channel}: ${message}`);
    }

    const { command, value } = parsedMessage;

    switch (command) {
      case 'JOIN':
        if (value.id !== this.uniqueId) {
          this.clientPings.set(value.id, Date.now());
          this.channelQuota = value.quota;
          if (this._ready) {
            this.updateQuota();
          }
          this.sendMessage('PING', this.uniqueId);
        }
        break;

      case 'LEAVE':
        this.clientPings.delete(value);
        if (this._ready) {
          this.updateQuota();
        }
        break;

      case 'PING':
        if (this.clientPings.has(value)) {
          this.clientPings.set(value, Date.now());
        } else {
          this.clientPings.set(value, Date.now());
          if (this._ready) {
            this.updateQuota();
          }
        }
        break;
    }
  }

  /** Remove outdated clients */
  private removeOutdatedClientPings() {
    const ancient = Date.now() - HEARTBEAT_INTERVAL * 3;
    const expired = [...this.clientPings].filter(([k, v]) => v <= ancient);
    expired.forEach(([k, v]) => this.clientPings.delete(k));
  }

  /** Calculate our quota -- our portion of the overall channel quota */
  private updateQuota() {
    this.removeOutdatedClientPings();
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
    if (getRandomInt(0, 5) === 0) { this.updateQuota(); }
  }

  /**
   * Promise that returns true when this queue manager is ready to use. Used by the unit
   * tests. There’s no reason to use this in normal code.
   * @returns true when the connection is ready
   * @throws if the connection is not ready within 5 seconds
   */
  public get ready() {
    return new Promise<boolean>(async (resolve, reject) => {
      const until = Date.now() + 5000;
      while (!this._ready) {
        if (Date.now() >= until) {
          reject(new Error('Redis connection for rate limiter is not ready'));
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      resolve(true);
    });
  }
}
