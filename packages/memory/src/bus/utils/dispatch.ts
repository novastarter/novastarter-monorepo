import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
import type { MessageHandler } from '../types.js';

/**
 * Subscribers whose last run failed and was logged; a further failure of the same one is not logged again until it
 * succeeds once.
 *
 * Two reasons. A permanently broken subscriber must not flood the log with one line per message. And the log itself
 * may travel over the bus — `LogsStream` of `@novastarter/logger` publishes every line on the `logs` channel — so a
 * `logs` subscriber that throws on every message would otherwise feed itself: throw, warn, publish, throw, without
 * end. Logging once and then staying quiet until the subscriber recovers cuts that loop after one round.
 *
 * @internal
 */
const failing: WeakSet<MessageHandler<never>> = new WeakSet();

/**
 * Hand a payload to every handler of a channel, each on its own.
 *
 * What both bus drivers do once a message is in: a handler that throws, or an async one that rejects, is logged as
 * a warning — through `toError`, so a thrown string still reaches the log — and the other handlers still run. A bus
 * is fire-and-forget: nobody awaits a subscriber, so this is the one place its failure can be seen. Repeated
 * failures of one subscriber are logged once, until it succeeds again; see {@link failing}.
 *
 * @typeParam T - Payload type.
 * @param channel - Channel the message came in on, for the log line.
 * @param handlers - The channel's subscribers; nothing happens when there are none.
 * @param payload - What every handler receives.
 */
export const dispatch = <T>(channel: string, handlers: Iterable<MessageHandler<T>> | undefined, payload: T): void => {
	// 1. No subscribers, nothing to do; a channel is looked up by the caller, which may find none
	if (handlers === undefined) {
		return;
	}

	// 2. Every handler runs inside its own `try`, and its answer — a promise, a thenable or nothing — goes through
	//    `Promise.resolve` so a rejection is caught the same way, and one failing subscriber neither stops the
	//    fan-out nor surfaces as an unhandled rejection
	for (const handler of handlers) {
		try {
			Promise.resolve(handler(payload)).then(
				() => recovered(handler),
				(error: unknown) => failed(channel, handler, error),
			);
		} catch (error) {
			failed(channel, handler, error);
		}
	}
};

/**
 * Record a subscriber's failure and log it, unless its previous run failed too.
 *
 * @param channel - Channel the message came in on.
 * @param handler - The subscriber that failed.
 * @param error - What it threw or rejected with.
 * @internal
 */
const failed = (channel: string, handler: MessageHandler<never>, error: unknown): void => {
	// 1. A subscriber already known to fail is not logged again: no flood, and no loop through a bus-borne log
	if (failing.has(handler)) {
		return;
	}

	failing.add(handler);

	// 2. The logger is read per failure, so a `registerLogger` after start-up is honoured
	useLogger().warn(toError(error), `A subscriber of bus channel "${channel}" failed`);
};

/**
 * Forget a subscriber's earlier failure, so its next one is logged again.
 *
 * @param handler - The subscriber that just succeeded.
 * @internal
 */
const recovered = (handler: MessageHandler<never>): void => {
	// 1. Cheap for the common case: deleting a member that is not there is a no-op
	failing.delete(handler);
};

/**
 * Log a message the bus could not read — a payload that is not the bus's own serialisation.
 *
 * @param channel - Channel the message came in on.
 * @param error - What decoding threw.
 */
export const reportUnreadable = (channel: string, error: unknown): void => {
	// 1. Not a subscriber's fault, so not subject to the once-per-failure rule: every foreign message is worth a line
	useLogger().warn(toError(error), `A message on bus channel "${channel}" could not be read`);
};
