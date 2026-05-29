import { EventEmitter } from "node:events";

/**
 * In-memory mock of a Redis pub/sub broker. One instance represents a single
 * "Redis server" and should be shared between every {@link MockRedisClient}
 * that needs to communicate with each other.
 *
 * @example
 * const broker = new MockRedisBroker();
 * const clientA = new MockRedisClient(broker);
 * const clientB = new MockRedisClient(broker);
 *
 * clientB.subscribe('updates', () => {});
 * clientA.publish('updates', 'hello'); // clientB receives the message
 */
export class MockRedisBroker {
  private subscribers = new Map<string, Set<MockRedisClient>>();

  /**
   * Register a client to receive messages on the given channel.
   * @param channel - The pub/sub channel to subscribe to.
   * @param client - The mock client that will receive messages for this channel.
   */
  subscribe(channel: string, client: MockRedisClient) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)?.add(client);
  }

  /**
   * Broadcast a message to every client subscribed to the given channel.
   * @param channel - The pub/sub channel to publish on.
   * @param message - The message payload to deliver.
   * @returns The number of clients that received the message.
   */
  publish(channel: string, message: string): number {
    const clients = this.subscribers.get(channel) ?? new Set();
    for (const client of clients) {
      client.emit("message", channel, message);
    }
    return clients.size;
  }
}

/**
 * Mock Redis client backed by a shared {@link MockRedisBroker}. Mimics the
 * minimal surface area of `redis` needed for pub/sub tests.
 *
 * Each client is an {@link EventEmitter}; subscribers receive messages via
 * the `"message"` event in the shape `(channel, message) => void`.
 */
export class MockRedisClient extends EventEmitter {
  private readonly broker: MockRedisBroker;

  /**
   * @param broker - The shared broker that coordinates messages between clients.
   */
  constructor(broker: MockRedisBroker) {
    super();
    this.broker = broker;
  }

  /**
   * Subscribe to a channel and notify the caller when complete.
   *
   * Yields the event loop before completing to mimic real async I/O.
   * @param channel - The channel to subscribe to.
   * @param cb - Called with `(null, 1)` once the subscription is active.
   */
  subscribe(channel: string, cb: (err: null, count: number) => void): void {
    setImmediate(() => {
      this.broker.subscribe(channel, this);
      cb(null, 1);
    });
  }

  /**
   * Publish a message to the given channel via the shared broker.
   *
   * Yields the event loop before publishing to mimic real async I/O.
   * @param channel - The channel to publish on.
   * @param message - The message payload.
   */
  publish(channel: string, message: string): void {
    setImmediate(() => {
      this.broker.publish(channel, message);
    });
  }

  /**
   * Create a new client backed by the same broker, simulating `redis.duplicate()`.
   * @returns A fresh {@link MockRedisClient} sharing the same broker.
   */
  duplicate() {
    return new MockRedisClient(this.broker);
  }
}
