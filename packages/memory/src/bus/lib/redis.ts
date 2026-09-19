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
} from '../../utils/index.js';
import type { Bus, MessageHandler } from '../types/class.js';
import type { BusConfigRedis } from '../types/config.js';

/**
 * Bus backed by Redis pub/sub, delivering messages to every subscribed process.
 *
 * Payloads are JSON-serialized and, above a size threshold, gzip-compressed. Redis puts a connection into
 * subscriber mode once it subscribes, so the bus publishes on the given connection and subscribes on a duplicate.
 *
 * @example
 * ```ts
 * const bus = new BusRedis({ redis: new Redis(), namespace: 'app' });
 *
 * await bus.subscribe('greetings', (payload) => console.log(payload));
 * ```
 */
export class BusRedis implements Bus {
	/**
	 * Connection used for publishing.
	 *
	 * @internal
	 */
	private pub: Redis;

	/**
	 * Dedicated connection in subscriber mode.
	 *
	 * @internal
	 */
	private sub: Redis;

	/**
	 * Prefix applied to every channel name.
	 *
	 * @internal
	 */
	private namespace: string;

	/**
	 * Whether payloads above {@link BusRedis.compressionMinSize} are gzipped.
	 *
	 * @internal
	 */
	private compression: boolean;

	/**
	 * Smallest serialized size, in bytes, that gets compressed.
	 *
	 * @internal
	 */
	private compressionMinSize: number;

	/**
	 * Subscribers per namespaced channel.
	 *
	 * @internal
	 */
	private handlers: Record<string, Set<MessageHandler<any>>>;

	/**
	 * Create the bus on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration without the `type` discriminant.
	 */
	constructor(config: Omit<BusConfigRedis, 'type'>) {
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
	 * @param message - Value sent to the subscribers.
	 */
	async publish<T = unknown>(channel: string, message: T): Promise<void> {
		// 1. Serialize and, when large enough to be worth it, compress
		let binaryArray = serialize(message);

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

		// 2. Only the first callback triggers a Redis `SUBSCRIBE`; later ones join the existing set
		if (existingSet === undefined) {
			const set = new Set<MessageHandler<T>>();
			set.add(callback);
			this.handlers[namespaced] = set;

			await this.sub.subscribe(namespaced);
		} else {
			existingSet.add(callback);
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
	 * Dispatch a raw message from Redis to the callbacks of its channel.
	 *
	 * One listener serves every channel and fans out from the handlers map, so the number of active Node handles
	 * does not grow with the number of subscriptions.
	 *
	 * @param channel - The namespaced channel the message was published on.
	 * @param message - Raw payload bytes.
	 * @internal
	 */
	private async messageBufferHandler(channel: Buffer, message: Buffer) {
		// 1. Redis reports the channel as bytes; decode it to look the handlers up
		const namespaced = uint8ArrayToString(bufferToUint8Array(channel));

		if (namespaced in this.handlers === false) {
			return;
		}

		// 2. Compression is decided per payload on publish, so detect it from the gzip header
		let binaryArray = bufferToUint8Array(message);

		if (this.compression === true && isCompressed(binaryArray)) {
			binaryArray = await decompress(binaryArray);
		}

		// 3. Deserialize once and hand the same value to every callback
		const deserialized = deserialize(binaryArray);

		this.handlers[namespaced]?.forEach((callback) => callback(deserialized));
	}
}
