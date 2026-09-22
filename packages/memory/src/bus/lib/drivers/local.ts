import { deserialize, serialize } from '../../../utils/index.js';
import type { BusDriver } from '../../driver.js';
import type { MessageHandler } from '../../types.js';
import { dispatch } from '../../utils/dispatch.js';

/**
 * Options of {@link BusDriverLocal}, the `local` driver; it has none.
 */
export type BusDriverLocalConfig = Record<string, never>;

/**
 * In-process bus: publishing calls the subscribers registered in this process, nothing more.
 *
 * It exists so code written against the `BusDriver` interface runs unchanged in a single-process setup; it adds no
 * cross-process delivery. What a subscriber receives is a serialised copy of the payload, as it would be from the
 * Redis bus, so code does not come to rely on sharing an object with the publisher.
 *
 * @example
 * ```ts
 * const bus = new BusDriverLocal({});
 *
 * await bus.subscribe('greetings', (payload) => console.log(payload));
 * await bus.publish('greetings', 'hello');
 * ```
 */
export class BusDriverLocal implements BusDriver {
	/**
	 * Subscribers per channel; a `Set` so the same callback is never registered twice, in a `Map` so a channel named
	 * like an `Object.prototype` member — `toString`, `constructor` — is a channel and not an inherited function.
	 *
	 * @internal
	 */
	private readonly handlers: Map<string, Set<MessageHandler<any>>>;

	/**
	 * Create an empty bus.
	 *
	 * @param _config - Driver-specific options, as given in the location's `options`; the local bus has none yet.
	 */
	constructor(_config: BusDriverLocalConfig = {}) {
		// 1. Start without subscribers
		this.handlers = new Map();
	}

	/**
	 * Deliver a payload to every subscriber of the channel.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value handed to every subscriber.
	 */
	async publish<T = unknown>(channel: string, payload: T): Promise<void> {
		// 1. Nobody listening, nothing to copy or deliver
		const handlers = this.handlers.get(channel);

		if (handlers === undefined || handlers.size === 0) {
			return;
		}

		// 2. Subscribers get what they would get from the Redis bus: a copy that went through the same serialisation,
		//    so a handler mutating its payload never reaches into the publisher's object, and a value the wire would
		//    not carry — a `Date`, an `undefined` field — arrives the same way on both backends
		const copy = deserialize<T>(serialize(payload));

		// 3. Every subscriber runs on its own and a failing one is logged, the same way the Redis bus fans out: a
		//    broken handler neither stops delivery to the others nor fails the publisher
		dispatch(channel, handlers, copy);
	}

	/**
	 * Register a callback for a channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 */
	async subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Create the channel's set on first use
		const set = this.handlers.get(channel) ?? new Set();

		set.add(callback);

		this.handlers.set(channel, set);
	}

	/**
	 * Remove a callback from a channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to unsubscribe from.
	 * @param callback - The callback that was passed to `subscribe`.
	 */
	async unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Unknown channels and callbacks are ignored rather than treated as errors
		this.handlers.get(channel)?.delete(callback);
	}
}
