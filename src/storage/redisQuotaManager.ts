import { getRandomInt, promisify, uniqueId } from '../util';

import { Quota } from './quota';
import { QuotaManager } from './quotaManager';
import { RedisClient } from 'redis';

/**
 * Coordinates rate limits across servers by storing the queue configuration in Redis and
 * delegating a portion of our rate limits to each registered client.
 */
export class RedisQuotaManager extends QuotaManager {
  public readonly uniqueId: string;
  private _ready = false;
  private heartbeatTimer: any = null;
  private readonly pubSubClient: RedisClient;
  private lastQuotaReceived: number = null;

  // record the client id and timestamp of incoming PINGs
  private knownClients = new Map<string, number>();

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
    this.uniqueId = uniqueId();
    this.knownClients.set(this.uniqueId, Date.now());
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

  /** Send a message to the shared Redis channel */
  private sendMessage(command: string, value: any) {
    return promisify(this.client.publish.bind(this.client))(
      this.quotaName,
      JSON.stringify({ command, value })
    );
  }

  /** Disconnect from the client pool */
  public async unregister() {
    /* istanbul ignore else */
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await promisify(this.pubSubClient.unsubscribe.bind(this.pubSubClient))();
    await this.sendMessage('BYE', this.uniqueId);
    this._quota = { interval: 1000, rate: 0, concurrency: 0 };
  }

  /** Receive client pings and quota update messages */
  private message(channel: string, message: any) {
    /* istanbul ignore if */
    if (channel !== this.quotaName) { return; }

    let command: string;
    let value: any;
    try {
      const parsedMessage = JSON.parse(message);
      command = parsedMessage.command;
      value = parsedMessage.value;
    } catch {
      const msg = `unrecognized Redis pub/sub message on channel ${channel}: ${message}`;
      console.error(msg);
    }

    if (command === 'PING') {
      const newClient = !this.knownClients.has(value);
      this.knownClients.set(value, Date.now());
      if (newClient) {
        this.updateQuota();
        if (value !== this.uniqueId) { this.sendMessage('PING', this.uniqueId); }
      }
      return;
    }

    if (command === 'BYE') {
      this.knownClients.delete(value);
      this.updateQuota();
      return;
    }

    if (command === 'QUOTA') {
      this.channelQuota = value;
      this.updateQuota();
      this.lastQuotaReceived = Date.now();
      this._ready = true;
    }
  }

  /** Calculate our quota -- our portion of the overall channel quota */
  private updateQuota() {
    // cull expired clients
    const expired = Date.now() - 90000;
    for (const [k, v] of this.knownClients) {
      if (v <= expired) { this.knownClients.delete(k); }
    }

    // how many clients do we know about on this channel?
    if (!this.knownClients.size) { return; }

    const newQuota: Quota = {
      rate: Math.floor(this.channelQuota.rate / this.knownClients.size),
      interval: this.channelQuota.interval
    };

    if (this.channelQuota.concurrency) {
      newQuota.concurrency =
        Math.floor(this.channelQuota.concurrency / this.knownClients.size);
    }

    this._quota = newQuota;
  }

  /** Periodically do housekeeping */
  private heartbeat() {
    // Let the others know we are still here
    this.sendMessage('PING', this.uniqueId);

    // Every now and then, check if we've got a quota message recently. If not, send one.
    if (getRandomInt(0, 5) === 0) {
      if (!this.lastQuotaReceived || Date.now() - this.lastQuotaReceived > 60000) {
        this.sendMessage('QUOTA', this.channelQuota);
      }
    }
  }

  /**
   * Promise that returns true when this queue manager is ready to use. Primarily for unit
   * testing. Requests are queued so this normally doesn't matter.
   * @returns true when the connection is ready
   * @throws if the connection is not ready within 5 seconds
   */
  public get ready() {
    const start = Date.now();
    return new Promise<boolean>((resolve, reject) => {
      const timerId = setInterval(() => {
        if (this._ready) {
          clearInterval(timerId);
          resolve(true);
        }
        /* istanbul ignore if */
        if (Date.now() > start + 5000) {
          clearInterval(timerId);
          const msg = 'Redis connection for rate limiting quota manager is not ready';
          reject(new Error(msg));
        }
      }, 100)
    });
  }
}
