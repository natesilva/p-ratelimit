import { promisify, sleep, uniqueId } from '../util';

import { Quota } from './quota';
import { QuotaManager } from './quotaManager';
import { RedisClientType, RedisDefaultModules, RedisFunctions, RedisScripts } from 'redis';
import * as IORedis from 'ioredis';

type RedisCompatibleClient = RedisClientType<RedisDefaultModules, RedisFunctions, RedisScripts> | IORedis.Redis | IORedis.Cluster;

/** QuotaManager that coordinates rate limits across servers. */
export class RedisQuotaManager extends QuotaManager {
  private readonly uniqueId = uniqueId();
  private readonly pubSubClient: RedisCompatibleClient;
  private readonly pingsReceived = new Map<string, number>();
  private readonly channelName: string;
  private readonly client: RedisCompatibleClient;
  private _ready: boolean;
  private heartbeatTimer: any = null;

  /**
   * @param channelQuota the overall quota to be split among all clients
   * @param channelName unique name for this quota - the Redis pub/sub channel name
   * @param client a Redis client (or a pair of Redis clients if using a specialty Redis library)
   * @param heartbeatInterval how often to ping the Redis channel (milliseconds)
   */
  constructor(
    private readonly channelQuota: Quota,
    channelName: string,
    client: RedisCompatibleClient | RedisCompatibleClient[],
    private readonly heartbeatInterval = 30000
  ) {
    // start with 0 concurrency so jobs don’t run until we’re ready
    super(
      Object.assign({}, channelQuota, {
        concurrency: channelQuota.fastStart ? channelQuota.concurrency : 0
      })
    );
    this._ready = Boolean(channelQuota.fastStart);
    this.channelName = `ratelimit-${channelName}`;

    const clients = Array.isArray(client) ? client : [client];

    if (clients.length === 1) {
      this.client = clients[0];
      if (typeof this.client['duplicate'] !== 'function') {
        const msg =
          '[p-ratelimit RedisQuotaManager] Your Redis client does not ' +
          'support the client.duplicate() function. Please provide an array of two ' +
          'clients instead.';
        throw new Error(msg);
      }
      this.pubSubClient = this.client['duplicate']();
    } else {
      this.client = clients[0];
      this.pubSubClient = clients[1];
    }

    this.register();
  }

  /** true once the Quota Manager has discovered its peers and calculated its quota */
  get ready() {
    return this._ready;
  }

  /** Join the client pool, coordinated by the shared channel on Redis */
  private async register() {
    this.pingsReceived.set(this.uniqueId, Date.now());

    this.pubSubClient.on('message', (channel, message) => this.message(channel, message));
    await promisify(this.pubSubClient['subscribe'].bind(this.pubSubClient))(
      this.channelName
    );

    this.ping();

    if (!this.channelQuota.fastStart) {
      await sleep(3000);
    }

    await this.updateQuota();
    this._ready = true;

    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatInterval);
  }

  /** Send a ping to the shared Redis channel */
  private ping() {
    this.client['publish'](this.channelName, JSON.stringify(this.uniqueId));
  }

  /** Receive client pings */
  private message(channel: string, message: any) {
    if (channel !== this.channelName) {
      return;
    }

    let uniqueId: string;
    try {
      uniqueId = JSON.parse(message);
    } catch {
      console.error(`invalid JSON on Redis pub/sub channel ${channel}: ${message}`);
      return;
    }

    const newClient = !this.pingsReceived.has(uniqueId);
    this.pingsReceived.set(uniqueId, Date.now());

    if (newClient) {
      this.ping();
      if (this.ready) {
        this.updateQuota();
      }
    }
  }

  /** Remove outdated clients */
  private removeOutdatedClients() {
    const ancient = Date.now() - this.heartbeatInterval * 3;
    const expired = [...this.pingsReceived].filter(([k, v]) => v <= ancient);
    expired.forEach(([k, v]) => this.pingsReceived.delete(k));
  }

  /** Calculate our portion of the overall channel quota */
  private updateQuota() {
    this.removeOutdatedClients();
    if (!this.pingsReceived.size) {
      return;
    }

    const newQuota = Object.assign({}, this.channelQuota);
    newQuota.rate = Math.floor(newQuota.rate / this.pingsReceived.size);
    if (newQuota.concurrency) {
      newQuota.concurrency = Math.floor(newQuota.concurrency / this.pingsReceived.size);
    }

    this._quota = newQuota;
  }

  /** Let the others know we’re here */
  private heartbeat() {
    this.ping();
    if (this.ready) {
      this.updateQuota();
    }
  }
}
