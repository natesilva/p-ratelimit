/// <reference types="redis" />

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

  /**
   * @param channelQuota the overall quota to be shared among all clients
   * @param quotaName unique name for this quota - used as a Redis pub/sub channel name
   * @param client a Redis client
   * @param pubSubClient another Redis client (used for pub/sub)
   * @param heartbeatFrequency how often to report to the server that we are still here
   */
  constructor(
    private readonly channelQuota: Quota,
    private readonly quotaName: string,
    private readonly client: RedisClient,
    private readonly pubSubClient: RedisClient,
    private readonly heartbeatFrequency = 30000
  ) {
    // Start with a zero quota; upon init we’ll receive our real quota over the pub-sub
    // channel.
    super({ interval: 1000, rate: 0, concurrency: 0 });
    this.uniqueId = uniqueId();
    this.register();
  }

  /**
   * Promise that returns true when the Redis connection is ready to use. Primarily for
   * unit testing. Under normal circumstances API requests will be queued, so you don’t
   * need to be concerned about when the connection becomes ready.
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

  /** Register this instance with the Redis server */
  private async register() {
    this.pubSubClient.on('message', (channel, message) => this.message(channel, message));
    await promisify(this.pubSubClient.subscribe.bind(this.pubSubClient))(this.quotaName);
    await this.heartbeat();
    await this.broadcastNewQuota();
    this.heartbeatTimer = setInterval(this.heartbeat.bind(this), this.heartbeatFrequency);
  }

  public async unregister() {
    /* istanbul ignore else */
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await promisify(this.pubSubClient.unsubscribe.bind(this.pubSubClient))();
  }

  /** Receive quota update messages */
  private message(channel: string, message: any) {
    /* istanbul ignore if */
    if (channel !== this.quotaName) { return; }
    const newQuota: Quota = JSON.parse(message);
    this._quota = Object.assign({}, newQuota);
    this._ready = true;
  }

  /** Calculate and broadcast a new quota */
  private async broadcastNewQuota() {
    const { liveClientIds } = await this.getClientUuids();

    const newQuota: Quota = {
      rate: Math.floor(this.channelQuota.rate / liveClientIds.length),
      interval: this.channelQuota.interval
    };

    if (this.channelQuota.concurrency) {
      newQuota.concurrency =
        Math.floor(this.channelQuota.concurrency / liveClientIds.length);
    }

    this.client.publish.bind(this.client)(this.quotaName, JSON.stringify(newQuota));
  }

  /** Periodically let Redis know we are still here */
  private async heartbeat() {
    // const timestamp = await this.getServerTimestamp();
    const timestamp = Date.now();

    await promisify(this.client.hset.bind(this.client))(
      this.quotaName,
      this.uniqueId,
      timestamp
    );

    // approximately every 10 heartbeats, do housekeeping
    if (getRandomInt(0, 10) === 0) { this.housekeeping(); }
  }

  /** Clear out expired clients, extend TTL of the hash */
  private async housekeeping() {
    const timestamp = Date.now();
    await promisify(this.client.expire.bind(this.client))(this.quotaName, 3600);
    const expiredCount = await this.clearExpiredClients();
    if (expiredCount) { await this.broadcastNewQuota(); }
  }

  /** Current server time as a Unix timestamp (resolution: 1 second) */
  private async getServerTimestamp() {
    const serverTime: Array<string> = await promisify(this.client.time.bind(this.client))();
    const result = parseInt(serverTime[0], 10);
    return result;
  }

  /** Return the uuids of live and expired clients */
  public async getClientUuids() {
    const expiredTime = Date.now() - this.heartbeatFrequency * 2;
    const allClients = await promisify(this.client.hgetall.bind(this.client))(this.quotaName);

    const liveClientIds: string[] = [];
    const expiredClientIds: string[] = [];

    Object.keys(allClients).forEach(uuid => {
      const lastHeartbeat = parseInt(allClients[uuid]);
      if (lastHeartbeat > expiredTime) { liveClientIds.push(uuid); }
      else { expiredClientIds.push(uuid); }
    });

    const result = {
      liveClientIds,
      expiredClientIds
    };

    return result;
  }

  /**
   * Clear out expired client registrations.
   * @returns number of expired clients
   */
  private async clearExpiredClients() {
    const { expiredClientIds } = await this.getClientUuids();

    if (expiredClientIds.length) {
      await promisify(this.client.hdel.bind(this.client))(
        this.quotaName,
        ...expiredClientIds
      );
    }

    return expiredClientIds.length;
  }
}
