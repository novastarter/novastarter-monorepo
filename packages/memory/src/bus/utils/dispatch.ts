import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
import type { MessageHandler } from '../types.js';

/**
 * Hand a payload to every handler of a channel, each on its own.
 *
 * What both bus drivers do once a message is in: a handler that throws, or an async one that rejects, is logged as
 * a warning — through `toError`, so a thrown string still reaches the log — and the other handlers still run. A bus
 * is fire-and-forget: nobody awaits a subscriber, so this is the one place its failure can be seen.
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
			Promise.resolve(handler(payload)).catch((error: unknown) => report(channel, error));
		} catch (error) {
			report(channel, error);
		}
	}
};

/**
 * Log a subscriber's failure as a warning.
 *
 * @param channel - Channel the message came in on.
 * @param error - What the subscriber threw or rejected with.
 * @internal
 */
const report = (channel: string, error: unknown): void => {
	// 1. The logger is read per failure, so a `registerLogger` after start-up is honoured
	useLogger().warn(toError(error), `A subscriber of bus channel "${channel}" failed`);
};
