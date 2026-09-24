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
	private readonly handlers: Map<string, Set<MessageHandler<unknown>>>;

	/**
	 * Create an empty bus.
	 *
	 * @param _config - Driver-specific options, as given in the location's `options`; the local bus has none yet.
	 */
	constructor(_config: BusDriverLocalConfig = {}) {
		// 1. A `Map`, not an object: a channel named like an `Object.prototype` member must stay a channel
		this.handlers = new Map();
	}

	/**
	 * Deliver a payload to every subscriber of the channel.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value handed to every subscriber.
	 * @throws `TypeError` when the payload cannot be serialised, such as a `BigInt` or a cyclic object, whether or
	 * not anybody subscribed.
	 */
	async publish<T = unknown>(channel: string, payload: T): Promise<void> {
		// 1. Serialise before looking for subscribers, as the Redis bus does: a payload the wire cannot carry fails the
		//    publisher on both backends at once, not only from the moment the first subscriber appears
		const binaryArray = serialize(payload);

		// 2. Nobody listening, nothing to deliver
		const handlers = this.handlers.get(channel);

		if (handlers === undefined) {
			return;
		}

		// 3. Subscribers get what they would get from the Redis bus: a copy that went through the same serialisation,
		//    so a handler mutating its payload never reaches into the publisher's object, and a value the wire would
		//    not carry — a `Date`, an `undefined` field — arrives the same way on both backends
		const copy = deserialize<T>(binaryArray);

		// 4. Every subscriber runs on its own and a failing one is logged, the same way the Redis bus fans out: a
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
		// 1. Create the channel's set on first use. The set keeps handlers of `unknown` payloads, so a callback typed for
		//    one payload is cast on its way in: a subscriber receives whatever is published, as on the Redis bus
		const set = this.handlers.get(channel) ?? new Set<MessageHandler<unknown>>();

		set.add(callback as MessageHandler<unknown>);

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
		const set = this.handlers.get(channel);

		if (set === undefined) {
			return;
		}

		// 2. The typed callback is cast to be found in the set of `unknown` handlers, the same widening as in `subscribe`
		set.delete(callback as MessageHandler<unknown>);

		// 3. The channel goes with its last subscriber, as it does on the Redis bus: a channel per request — `reply:<id>`
		//    — would otherwise leave an empty set behind for every request for the life of the process
		if (set.size === 0) {
			this.handlers.delete(channel);
		}
	}
}
