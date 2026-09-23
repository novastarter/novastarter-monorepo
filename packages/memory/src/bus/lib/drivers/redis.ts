import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
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
	 * Subscribers per namespaced channel; a `Set` so the same callback is never registered twice, in a `Map` so a
	 * channel named like an `Object.prototype` member — `toString`, `constructor` — is a channel and not an
	 * inherited function.
	 *
	 * @internal
	 */
	private handlers: Map<string, Set<MessageHandler<unknown>>>;

	/**
	 * The Redis `SUBSCRIBE` under way per namespaced channel, while it is; every `subscribe()` of that channel waits
	 * for the same one, so all of them learn whether Redis took it. A `Map` for the reason given at
	 * {@link BusDriverRedis.handlers}: a channel named like an `Object.prototype` member must stay a channel.
	 *
	 * @internal
	 */
	private pending: Map<string, Promise<void>> = new Map();

	/**
	 * The handling of the messages received so far, one after the other.
	 *
	 * Decompressing is asynchronous, so a small plain message arriving right after a gzipped one would otherwise be
	 * handed to the subscribers first; chaining every message onto the previous one keeps the order Redis sent them
	 * in, which is what a subscriber to a stream of invalidations or log lines relies on.
	 *
	 * @internal
	 */
	private inbox: Promise<void> = Promise.resolve();

	/**
	 * The handing of the messages published so far to the connection, one after the other.
	 *
	 * Compressing is asynchronous, so a small plain message published right after a large one would otherwise reach
	 * Redis first, while the large one is still in zlib's thread pool; chaining every publish onto the previous one
	 * keeps the order the caller published in, the same guarantee {@link BusDriverRedis.inbox} gives on the way in.
	 * A publish waits for the one before it to be handed to the connection, not for Redis to answer it, so the
	 * commands still pipeline.
	 *
	 * @internal
	 */
	private outbox: Promise<void> = Promise.resolve();

	/**
	 * Callbacks registered through {@link BusDriverRedis.onReconnect}, run each time the subscriber reconnects.
	 *
	 * @internal
	 */
	private readonly reconnectCallbacks: Set<() => void | Promise<void>> = new Set();

	/**
	 * Whether the subscribing connection has been `ready` before, which tells the first connect from a reconnect.
	 *
	 * @internal
	 */
	private wasReady = false;

	/**
	 * Whether {@link BusDriverRedis.close} was called; a subscription can neither start nor complete afterwards.
	 *
	 * @internal
	 */
	private closed = false;

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

		// 2. The duplicate is the driver's own connection, so an error on it is the driver's to handle: ioredis emits
		//    `error` as a matter of course while a flapping connection retries, and an `error` event with no listener is
		//    fatal to the host process — the failure is logged the way every other failure of the bus is, and the
		//    connection keeps retrying underneath
		this.sub.on('error', (error: Error) => {
			// 1. `toError`, so whatever shape the connection failure has still reaches the log as an error
			useLogger().warn(toError(error), 'The Redis subscriber connection of the bus failed');
		});

		// 3. One listener for every channel; the binary event keeps compressed payloads intact, and every message is
		//    handled after the one before it, so an asynchronous decompression cannot reorder the stream
		this.sub.on('messageBuffer', (channel, message) => {
			// 1. Payload errors are handled inside the handler, but its logging can still throw; a rejection is
			//    neither observed by anyone nor allowed to turn the chain rejected, which would skip every later
			//    message — so it is swallowed, the chain is kept and the promise of this message is not needed
			this.inbox = this.inbox.then(() => this.messageBufferHandler(channel, message)).catch(() => {});
		});

		// 4. ioredis resubscribes on its own after a reconnect, but whatever was published while the connection was
		//    down never arrives: every `ready` after the first one tells the reconnect callbacks, so a subscriber can
		//    reset state that relied on those messages. A failing callback is logged and does not stop the others
		this.sub.on('ready', () => {
			// 1. The first `ready` is the initial connect, nothing was missed before it
			if (!this.wasReady) {
				this.wasReady = true;

				return;
			}

			// 2. ioredis emits `ready` before it sends the resubscribe, so a reset done right here would leave a gap in
			//    which an invalidation is still lost and a read refills the reset state with an old value. The PING is
			//    sent a microtask later, once ioredis has queued the `SUBSCRIBE`, and replies come back in order: when
			//    it answers, the subscription is active on the server. A failed PING means the connection is gone
			//    again; the callbacks still run, a reset is harmless and the next `ready` repeats it
			void Promise.resolve()
				.then(() => this.sub.ping())
				.catch(() => {})
				.then(() => this.runReconnectCallbacks());
		});

		// 5. Apply the documented defaults: compress, but only from 1 kB up
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1000;
		this.handlers = new Map();
	}

	/**
	 * Publish a payload to every subscriber of the channel, in every process.
	 *
	 * Messages reach Redis in the order they were published, whether or not the caller awaits each one: a large
	 * payload being gzipped does not let the small one published right after it overtake.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value sent to the subscribers.
	 * @throws `TypeError` when the payload cannot be serialised, such as a `BigInt` or a cyclic object; the error
	 * Redis answered the `PUBLISH` with.
	 */
	async publish<T = unknown>(channel: string, payload: T): Promise<void> {
		// 1. The reply is kept apart from the chain: the chain moves on as soon as the command is handed to the
		//    connection, so a slow answer from Redis delays no later publish, only this caller
		let reply: Promise<number> | undefined;

		// 2. Serialise, compress when large enough to be worth it and hand the bytes to the connection, all behind the
		//    publish before it, so an asynchronous compression cannot reorder the stream; ioredis queues the command
		//    synchronously, which is why the chain may move on right after the call
		const issued = this.outbox.then(async () => {
			// 1. Serialise first, so a payload the wire cannot carry fails the caller before anything is sent, and
			//    compress only from the size where the savings pay for the CPU time
			let binaryArray = serialize(payload);

			if (this.compression === true && binaryArray.byteLength >= this.compressionMinSize) {
				binaryArray = await compress(binaryArray);
			}

			// 2. Bytes, not a string: a gzipped payload would be mangled by ioredis' UTF-8 encoding
			reply = this.pub.publish(withNamespace(channel, this.namespace), uint8ArrayToBuffer(binaryArray));
		});

		// 3. A failing publish is the caller's business alone; the chain must stay usable for the next one
		this.outbox = issued.catch(() => {});

		await issued;
		await reply;
	}

	/**
	 * Register a callback for a channel, subscribing in Redis on the channel's first callback.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 * @throws The error Redis answered the `SUBSCRIBE` with; the callback is not registered then, so the call can be
	 * retried. `Error` when the bus was closed, before the call or while Redis was being asked: the callback is gone
	 * with the connection and would never be called.
	 */
	async subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. A closed bus subscribes to nothing: its connection is gone, so the caller is told rather than handed a
		//    callback that would never fire
		this.assertOpen();

		// 2. Handlers are keyed by the namespaced name, the form Redis reports incoming messages under
		const namespaced = withNamespace(channel, this.namespace);

		const existingSet = this.handlers.get(namespaced);

		// 3. Only the first callback triggers a Redis `SUBSCRIBE`; later ones join the existing set — and wait for the
		//    `SUBSCRIBE` still under way, if any, so a caller that joined while Redis was being asked learns of a
		//    failure too instead of being told its handler is in place when the set is about to go. A `close()` that
		//    landed meanwhile dropped the set as well, and is reported the same way. The set keeps handlers of
		//    `unknown` payloads, so a callback typed for one payload is cast on its way in: a subscriber receives
		//    whatever is published, the same widening the local driver's untyped set relies on
		if (existingSet !== undefined) {
			existingSet.add(callback as MessageHandler<unknown>);
			await this.pending.get(namespaced);
			this.assertOpen();

			return;
		}

		const set = new Set<MessageHandler<unknown>>();
		set.add(callback as MessageHandler<unknown>);
		this.handlers.set(namespaced, set);

		// 4. A `SUBSCRIBE` that fails leaves no set behind: with one in place, a retry would take the branch above and
		//    add its callback without ever asking Redis again, so the channel would stay silent for good. The promise
		//    is shared with the callers that join meanwhile and forgotten once settled. Both removals check identity:
		//    an `unsubscribe` and a fresh `subscribe` may have replaced the set and the promise while this one was in
		//    flight, and a stale failure must not wipe out that newer subscription
		const subscription = this.sub.subscribe(namespaced).then(
			() => {},
			(error: unknown) => {
				// 1. Only this call's own set goes; the error still reaches every caller awaiting this subscription
				if (this.handlers.get(namespaced) === set) {
					this.handlers.delete(namespaced);
				}

				throw error;
			},
		);

		this.pending.set(namespaced, subscription);

		try {
			await subscription;
		} finally {
			if (this.pending.get(namespaced) === subscription) {
				this.pending.delete(namespaced);
			}
		}

		// 5. Redis took the subscription, but a `close()` that landed while it was on the wire has quit the connection
		//    and dropped the set: the caller is told, not left with a resolved promise and no subscription behind it
		this.assertOpen();
	}

	/**
	 * Remove a callback from a channel, unsubscribing in Redis once the channel has no callbacks left.
	 *
	 * Once the bus is closed the call does nothing: {@link BusDriverRedis.close} has quit or dropped the subscribing
	 * connection, so a Redis command issued now would sit in the offline queue of a connection that can never answer
	 * and the promise would never settle.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to unsubscribe from.
	 * @param callback - The callback that was passed to `subscribe`.
	 */
	async unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. A closed bus unsubscribes from nothing, and must not reach for the connection to do it: quit or dropped by
		//    `close()`, it can no longer answer — on a never-ready connection the command waits in ioredis' offline
		//    queue forever, and a caller cleaning up after or racing the close hangs on a promise that never settles.
		//    `close()` dropped every handler set as well; the check states the invariant outright instead of relying on
		//    the map being empty
		if (this.closed) {
			return;
		}

		// 2. Handlers are keyed by the namespaced name, the form Redis reports incoming messages under
		const namespaced = withNamespace(channel, this.namespace);

		const set = this.handlers.get(namespaced);

		if (set === undefined) {
			return;
		}

		// 3. The set keeps handlers of `unknown` payloads, so the typed callback is cast to be found in it — the same
		//    widening as on the way in through `subscribe`
		set.delete(callback as MessageHandler<unknown>);

		// 4. Drop the Redis subscription once nobody listens, so the connection stops receiving those messages
		if (set.size === 0) {
			this.handlers.delete(namespaced);

			await this.sub.unsubscribe(namespaced);
		}
	}

	/**
	 * Register a callback run every time the subscribing connection comes back after it was lost.
	 *
	 * Redis pub/sub keeps no messages: whatever was published while the subscriber was disconnected is lost, even
	 * though ioredis resubscribes to every channel afterwards. The callback is where a subscriber resets state it
	 * derived from those messages. It runs once the server answered a PING sent behind the resubscribe, so no
	 * message published after the callback started can be missed. It is not run on the first connect.
	 *
	 * @param callback - Invoked after each reconnect; a throw or rejection is logged.
	 *
	 * @example
	 * ```ts
	 * bus.onReconnect(() => localCache.clear());
	 * ```
	 */
	onReconnect(callback: () => void | Promise<void>): void {
		// 1. A `Set`, so registering the same callback twice still runs it once per reconnect
		this.reconnectCallbacks.add(callback);
	}

	/**
	 * Run every callback registered through {@link BusDriverRedis.onReconnect}, each on its own.
	 *
	 * A sync throw or a rejection of one callback is logged and does not keep the others from running.
	 */
	private runReconnectCallbacks(): void {
		// 1. Each callback on its own, sync throws and rejections alike, so one failure cannot skip the rest
		for (const callback of this.reconnectCallbacks) {
			Promise.resolve()
				.then(callback)
				.catch((error: unknown) => {
					// 1. Nobody awaits the callback, so the failure goes to the log instead of an unhandled rejection
					useLogger().warn(toError(error), 'A reconnect callback of the bus failed');
				});
		}
	}

	/**
	 * Quit the subscribing connection; the process is shutting down.
	 *
	 * The publishing connection belongs to the caller — the `@novastarter/redis` location it came from — and is
	 * closed there.
	 *
	 * @returns Once the server acknowledged the quit, or the connection was dropped without one.
	 */
	async close(): Promise<void> {
		// 1. Closed first, so a `subscribe()` racing the quit — its `SUBSCRIBE` on the wire, answered before the queued
		//    `QUIT` — rejects instead of resolving with its handler already dropped
		this.closed = true;

		// 2. Only the duplicate is the driver's own; its subscriptions end with it, so the handlers and any `SUBSCRIBE`
		//    still under way can go too
		this.handlers = new Map();
		this.pending = new Map();

		// 3. The duplicate connects lazily on its first `SUBSCRIBE`, so on a deployment whose Redis is unreachable it
		//    never left `connecting`/`reconnecting`; `quit` sends QUIT through the normal command path, which would
		//    reconnect forever to deliver it and never resolve, hanging the shutdown — a connection that is not
		//    `ready` is dropped with `disconnect` instead, which sends nothing and waits for nothing
		if (this.sub.status !== 'ready') {
			this.sub.disconnect();

			return;
		}

		// 4. A connected subscriber quits gracefully: the server is told and pending replies are waited for
		await this.sub.quit();
	}

	/**
	 * Refuse to go on once the bus is closed.
	 *
	 * Called before a subscription starts and again after every wait inside it, since `close()` may have landed
	 * while Redis was being asked.
	 *
	 * @throws `Error` when {@link BusDriverRedis.close} was called.
	 * @internal
	 */
	private assertOpen(): void {
		// 1. One message for both moments, before the call and during it: the outcome for the caller is the same
		if (this.closed) {
			throw new Error('The bus is closed; it subscribes to nothing any more');
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
	private async messageBufferHandler(channel: Buffer, message: Buffer): Promise<void> {
		// 1. Redis reports the channel as bytes; decode it to look the handlers up
		const namespaced = uint8ArrayToString(bufferToUint8Array(channel));
		const handlers = this.handlers.get(namespaced);

		if (handlers === undefined) {
			return;
		}

		// 2. Decode the payload — compression is decided per payload on publish, so it is detected from the gzip header
		//    alone: a payload gzipped by a publisher with compression on must read back fine for a bus with it off. A
		//    payload this bus did not write, a foreign client's plain text or a truncated gzip, fails here; the listener
		//    is fire-and-forget, so the failure is logged rather than left as an unhandled rejection that would end the
		//    process
		let payload: unknown;

		try {
			let binaryArray = bufferToUint8Array(message);

			if (isCompressed(binaryArray)) {
				binaryArray = await decompress(binaryArray);
			}

			payload = deserialize(binaryArray);
		} catch (error) {
			reportUnreadable(namespaced, error);

			return;
		}

		// 3. Hand the same value to every callback, each on its own: a failing subscriber is logged and the others
		//    still run
		dispatch(namespaced, handlers, payload);
	}
}
