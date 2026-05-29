import { scheduler } from "node:timers/promises";
import { promisify } from "node:util";
import type * as IORedis from "ioredis";
import type { RedisClient } from "redis";
import { uniqueId } from "../util.ts";
import type { Quota } from "./quota.ts";
import { QuotaManager } from "./quotaManager.ts";

export type RedisCompatibleClient = RedisClient | IORedis.Redis | IORedis.Cluster;

/** QuotaManager that coordinates rate limits across servers. */
export class RedisQuotaManager extends QuotaManager {
  private readonly channelQuota: Quota;
  private readonly heartbeatInterval: number;
  private readonly uniqueId = uniqueId();
  private readonly pubSubClient: RedisCompatibleClient;
  private readonly pingsReceived = new Map<string, number>();
  private readonly channelName: string;
  private readonly client: RedisCompatibleClient;
  private _ready: boolean;
  private _heartbeatTimer?: ReturnType<typeof setInterval>;

  /**
   * @param channelQuota the overall quota to be split among all clients
   * @param channelName unique name for this quota - the Redis pub/sub channel name
   * @param client a Redis client (or a pair of Redis clients if using a specialty Redis library)
   * @param heartbeatInterval how often to ping the Redis channel (milliseconds)
   */
  constructor(
    channelQuota: Quota,
    channelName: string,
    client: RedisCompatibleClient | RedisCompatibleClient[],
    heartbeatInterval = 30000,
  ) {
    // start with 0 concurrency so jobs don’t run until we’re ready
    super(
      Object.assign({}, channelQuota, {
        concurrency: channelQuota.fastStart ? channelQuota.concurrency : 0,
      }),
    );
    this.channelQuota = channelQuota;
    this.heartbeatInterval = heartbeatInterval;
    this._ready = Boolean(channelQuota.fastStart);
    this.channelName = `ratelimit-${channelName}`;

    const clients = Array.isArray(client) ? client : [client];

    if (clients.length === 1) {
      this.client = clients[0];
      if (typeof this.client.duplicate !== "function") {
        const msg =
          "[p-ratelimit RedisQuotaManager] Your Redis client does not " +
          "support the client.duplicate() function. Please provide an array of two " +
          "clients instead.";
        throw new Error(msg);
      }
      this.pubSubClient = this.client.duplicate();
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

    this.pubSubClient.on("message", this._messageListener);
    await promisify(this.pubSubClient.subscribe.bind(this.pubSubClient))(
      this.channelName,
    );

    this.ping();

    if (!this.channelQuota.fastStart) {
      await scheduler.wait(3000);
    }

    this.updateQuota();
    this._ready = true;

    this._heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatInterval);
    this._heartbeatTimer.unref();
  }

  /** Stop the heartbeat timer and unsubscribe from the Redis channel. */
  async destroy() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
    this.pubSubClient.removeListener("message", this._messageListener);
    const unsubscribe = promisify(
      this.pubSubClient.unsubscribe.bind(this.pubSubClient) as (
        channel: string,
        cb: (err: Error | null, count?: number) => void,
      ) => void,
    );
    await unsubscribe(this.channelName);
  }

  private _messageListener = (channel: string, message: string) => {
    this.message(channel, message);
  };

  /** Send a ping to the shared Redis channel */
  private ping() {
    this.client.publish(this.channelName, JSON.stringify(this.uniqueId));
  }

  /** Receive client pings */
  private message(channel: string, message: string) {
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
    const expired = [...this.pingsReceived].filter(([_k, v]) => v <= ancient);
    expired.forEach(([k, _v]) => {
      this.pingsReceived.delete(k);
    });
  }

  /** Calculate our portion of the overall channel quota */
  private updateQuota() {
    this.removeOutdatedClients();
    if (!this.pingsReceived.size) {
      return;
    }

    const newQuota = Object.assign({}, this.channelQuota);
    if (newQuota.rate !== undefined) {
      newQuota.rate = Math.floor(newQuota.rate / this.pingsReceived.size);
    }
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
