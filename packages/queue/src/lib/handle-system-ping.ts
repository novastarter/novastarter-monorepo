import { useLogger } from '@novastarter/logger';
import type { Logger } from 'pino';
import type { systemPing } from '../contracts/system.js';
import type { JobContext, JobHandler } from '../types.js';

/**
 * What {@link createSystemPingHandler} takes.
 */
export interface SystemPingHandlerOptions {
	/** Where the ping is written; the app's logger unless given. */
	logger?: Logger | undefined;
}

/**
 * Build the handler of the `system.ping` job — the reference the web app registers with `registerJobHandlers()`.
 *
 * The job proves the whole pipeline: the schedule or an explicit `enqueue()` on one side, the provider, the worker and
 * its delivery back into the app on the other. All the handler does is log where the ping came from and how long it
 * took to arrive, so the log of a healthy deployment shows the round trip.
 *
 * ```ts
 * registerJobHandlers({ 'system.ping': createSystemPingHandler() });
 * ```
 *
 * @param options - The logger.
 * @returns The handler.
 */
export const createSystemPingHandler = (options: SystemPingHandlerOptions = {}): JobHandler<typeof systemPing> => {
	return async (payload, context: JobContext): Promise<void> => {
		const logger = options.logger ?? useLogger();

		// 1. The wait between enqueue and run is what the ping measures; the payload's own stamp wins when it carries one
		const sentAt = payload.at ? new Date(payload.at) : context.enqueuedAt;
		const delay = Math.max(0, Date.now() - sentAt.getTime());

		// 2. One line with everything the reader needs to tell pings apart
		logger.info(`Ping "${payload.message}" (${context.id}) arrived after ${delay} ms on attempt ${context.attempt}`);
	};
};
