import type { Redis } from 'ioredis';
import {
	bufferToUint8Array,
	compress,
	decompress,
	deserialize,
	isCompressed,
	serialize,
	uint8ArrayToBuffer,
	uint8ArrayToString,
	withNamespace,
} from '../../../utils/index.js';
import type { BusDriver } from '../../driver.js';
import type { MessageHandler } from '../../types.js';
import { dispatch, reportUnreadable } from '../../utils/dispatch.js';

/**
 * Options of {@link BusDriverRedis}, the `redis` driver.
 */
export type BusDriverRedisConfig = {
	/**
	 * Prefix for every channel name in Redis.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of published payloads.
	 *
	 * @defaultValue true
	 */
	compression?: boolean | undefined;

	/**
	 * Minimum byte size of a payload before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @defaultValue 1000
	 */
	compressionMinSize?: number | undefined;

	/**
	 * Existing or new Redis connection to publish through; a duplicate of it is opened for subscribing.
	 */
	redis: Redis;
};

/**
 * Bus backed by Redis pub/sub, delivering messages to every subscribed process.
 *
 * Payloads are JSON-serialized and, above a size threshold, gzip-compressed. Redis puts a connection into
 * subscriber mode once it subscribes, so the bus publishes on the given connection and subscribes on a duplicate.
 *
 * @example
 * ```ts
 * const bus = new BusDriverRedis({
 * 	redis: new Redis(),
 * 	namespace: 'app',
 * });
 *
 * await bus.subscribe('greetings', (payload) => console.log(payload));
 * ```
 */
export class BusDriverRedis implements BusDriver {
	/**
	 * Connection used for publishing.
	 *
	 * @internal
	 */
	private readonly pub: Redis;

	/**
	 * Dedicated connection in subscriber mode.
	 *
	 * @internal
	 */
	private readonly sub: Redis;

	/**
	 * Prefix applied to every channel name.
	 *
	 * @internal
	 */
	private readonly namespace: string;

	/**
	 * Whether payloads above {@link BusDriverRedis.compressionMinSize} are gzipped.
	 *
	 * @internal
	 */
	private readonly compression: boolean;

	/**
	 * Smallest serialized size, in bytes, that gets compressed.
	 *
	 * @internal
	 */
	private readonly compressionMinSize: number;

	/**
	 * Subscribers per namespaced channel.
	 *
	 * @internal
	 */
	private handlers: Record<string, Set<MessageHandler<any>>>;

	/**
	 * The Redis `SUBSCRIBE` under way per namespaced channel, while it is; every `subscribe()` of that channel waits
	 * for the same one, so all of them learn whether Redis took it.
	 *
	 * @internal
	 */
	private pending: Record<string, Promise<void>> = {};

	/**
	 * Create the bus on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 */
	constructor(config: BusDriverRedisConfig) {
		// 1. Publish on the caller's connection and subscribe on a duplicate, since a subscribed connection can no
		//    longer run regular commands
		this.namespace = config.namespace;
		this.pub = config.redis;
		this.sub = config.redis.duplicate();

		// 2. One listener for every channel; the binary event keeps compressed payloads intact
		this.sub.on('messageBuffer', (channel, message) => this.messageBufferHandler(channel, message));

		// 3. Apply the documented defaults: compress, but only from 1 kB up
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1000;
		this.handlers = {};
	}

	/**
	 * Publish a payload to every subscriber of the channel, in every process.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value sent to the subscribers.
	 */
	async publish<T = unknown>(channel: string, payload: T): Promise<void> {
		// 1. Serialize and, when large enough to be worth it, compress
		let binaryArray = serialize(payload);

		if (this.compression === true && binaryArray.byteLength >= this.compressionMinSize) {
			binaryArray = await compress(binaryArray);
		}

		// 2. Publish under the namespaced channel name as raw bytes
		await this.pub.publish(withNamespace(channel, this.namespace), uint8ArrayToBuffer(binaryArray));
	}

	/**
	 * Register a callback for a channel, subscribing in Redis on the channel's first callback.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 */
	async subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Handlers are keyed by the namespaced name, the form Redis reports incoming messages under
		const namespaced = withNamespace(channel, this.namespace);

		const existingSet = this.handlers[namespaced];

		// 2. Only the first callback triggers a Redis `SUBSCRIBE`; later ones join the existing set — and wait for the
		//    `SUBSCRIBE` still under way, if any, so a caller that joined while Redis was being asked learns of a
		//    failure too instead of being told its handler is in place when the set is about to go
		if (existingSet !== undefined) {
			existingSet.add(callback);
			await this.pending[namespaced];

			return;
		}

		const set = new Set<MessageHandler<T>>();
		set.add(callback);
		this.handlers[namespaced] = set;

		// 3. A `SUBSCRIBE` that fails leaves no set behind: with one in place, a retry would take the branch above and
		//    add its callback without ever asking Redis again, so the channel would stay silent for good. The promise
		//    is shared with the callers that join meanwhile and forgotten once settled. Both removals check identity:
		//    an `unsubscribe` and a fresh `subscribe` may have replaced the set and the promise while this one was in
		//    flight, and a stale failure must not wipe out that newer subscription
		const subscription = this.sub.subscribe(namespaced).then(
			() => {},
			(error: unknown) => {
				if (this.handlers[namespaced] === set) {
					delete this.handlers[namespaced];
				}

				throw error;
			},
		);

		this.pending[namespaced] = subscription;

		try {
			await subscription;
		} finally {
			if (this.pending[namespaced] === subscription) {
				delete this.pending[namespaced];
			}
		}
	}

	/**
	 * Remove a callback from a channel, unsubscribing in Redis once the channel has no callbacks left.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to unsubscribe from.
	 * @param callback - The callback that was passed to `subscribe`.
	 */
	async unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Look the channel up under its namespaced name
		const namespaced = withNamespace(channel, this.namespace);

		const set = this.handlers[namespaced];

		if (set === undefined) {
			return;
		}

		set.delete(callback);

		// 2. Drop the Redis subscription once nobody listens, so the connection stops receiving those messages
		if (set.size === 0) {
			delete this.handlers[namespaced];

			await this.sub.unsubscribe(namespaced);
		}
	}

	/**
	 * Quit the subscribing connection; the process is shutting down.
	 *
	 * The publishing connection belongs to the caller — the `@novastarter/redis` location it came from — and is
	 * closed there.
	 *
	 * @returns Once the server acknowledged the quit.
	 */
	async close(): Promise<void> {
		// 1. Only the duplicate is the driver's own; its subscriptions end with it, so the handlers can go too
		this.handlers = {};
		await this.sub.quit();
	}

	/**
	 * Dispatch a raw message from Redis to the callbacks of its channel.
	 *
	 * One listener serves every channel and fans out from the handlers map, so the number of active Node handles
	 * does not grow with the number of subscriptions.
	 *
	 * @param channel - The namespaced channel the message was published on.
	 * @param message - Raw payload bytes.
	 * @internal
	 */
	private async messageBufferHandler(channel: Buffer, message: Buffer): Promise<void> {
		// 1. Redis reports the channel as bytes; decode it to look the handlers up
		const namespaced = uint8ArrayToString(bufferToUint8Array(channel));

		if (!(namespaced in this.handlers)) {
			return;
		}

		// 2. Decode the payload — compression is decided per payload on publish, so it is detected from the gzip
		//    header. A payload this bus did not write, a foreign client's plain text or a truncated gzip, fails here;
		//    the listener is fire-and-forget, so the failure is logged rather than left as an unhandled rejection
		//    that would end the process
		let payload: unknown;

		try {
			let binaryArray = bufferToUint8Array(message);

			if (this.compression === true && isCompressed(binaryArray)) {
				binaryArray = await decompress(binaryArray);
			}

			payload = deserialize(binaryArray);
		} catch (error) {
			reportUnreadable(namespaced, error);

			return;
		}

		// 3. Hand the same value to every callback, each on its own: a failing subscriber is logged and the others
		//    still run
		dispatch(namespaced, this.handlers[namespaced], payload);
	}
}
