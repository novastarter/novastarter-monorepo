import { useLogger } from '@novastarter/logger';
import {
	defineJob,
	type JobContext,
	type JobContract,
	type JobHandler,
	registerJob,
	registerSchedule,
} from '@novastarter/queue';
import { z } from 'zod';

/**
 * What a caller passes to `system.ping`.
 */
export interface SystemPingInput {
	/** Free text echoed by the handler, `ping` unless given. */
	message?: string | undefined;
	/** When the ping was scheduled, ISO 8601. */
	at?: string | undefined;
}

/**
 * What the `system.ping` handler receives.
 */
export interface SystemPingPayload extends Omit<SystemPingInput, 'message'> {
	message: string;
}

/**
 * What {@link createSystemPingHandler} takes.
 */
export interface SystemPingHandlerOptions {
	/** Where the ping is written; the app's logger unless given. */
	logger?: ReturnType<typeof useLogger> | undefined;
}

/**
 * Schema of a {@link SystemPingPayload}.
 */
export const systemPingSchema: z.ZodType<SystemPingPayload, SystemPingInput> = z.object({
	message: z.string().default('ping'),
	at: z.iso.datetime().optional(),
});

/**
 * `system.ping` — a job that does nothing but log; proves the queue, the worker and the callback into the web app
 * are wired, and is what the development schedule runs. Registered with the queue when this module loads, so
 * `enqueue('system.ping', …)` is known wherever the bootstrap ran.
 */
export const systemPing: JobContract<'system.ping', typeof systemPingSchema> = registerJob(
	defineJob({
		name: 'system.ping',
		schema: systemPingSchema,
		options: {
			attempts: 1,
			removeOnComplete: true,
		},
	}),
);

/**
 * Registers the contract in the job map of `@novastarter/queue`, so `enqueue('system.ping', payload)` checks the
 * payload against {@link systemPingSchema}.
 */
declare module '@novastarter/queue' {
	interface JobRegistry {
		'system.ping': typeof systemPing;
	}
}

/**
 * How often the development ping fires.
 *
 * @defaultValue every five minutes
 */
export const DEV_PING_SCHEDULE = '*/5 * * * *';

// A heartbeat through the whole pipeline is worth having while developing, noise in production; registered at load
// like the contract, so `startSchedules()` of a worker picks it up wherever the bootstrap ran
registerSchedule({
	job: 'system.ping',
	cron: DEV_PING_SCHEDULE,
	payload: { message: 'scheduled ping' },
	enabled: (env) => env['NODE_ENV'] === 'development',
});

/**
 * Build the handler of the `system.ping` job — what the bootstrap registers with `registerJobHandlers()`.
 *
 * The job proves the whole pipeline: the schedule or an explicit `enqueue()` on one side, the provider, the worker and
 * its delivery back into the app on the other. All the handler does is log where the ping came from and how long it
 * took to arrive, so the log of a healthy deployment shows the round trip.
 *
 * @param options - The logger.
 * @returns The handler.
 */
export const createSystemPingHandler = (options: SystemPingHandlerOptions = {}): JobHandler<typeof systemPing> => {
	return async (payload: SystemPingPayload, context: JobContext): Promise<void> => {
		const logger = options.logger ?? useLogger();

		// 1. The wait between enqueue and run is what the ping measures; the payload's own stamp wins when it carries one
		const sentAt = payload.at ? new Date(payload.at) : context.enqueuedAt;
		const delay = Math.max(0, Date.now() - sentAt.getTime());

		// 2. One line with everything the reader needs to tell pings apart
		logger.info(`Ping "${payload.message}" (${context.id}) arrived after ${delay} ms on attempt ${context.attempt}`);
	};
};
