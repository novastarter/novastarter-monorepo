import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

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
 * Schema of a {@link SystemPingPayload}.
 */
export const systemPingSchema: z.ZodType<SystemPingPayload, SystemPingInput> = z.object({
	message: z.string().default('ping'),
	at: z.iso.datetime().optional(),
});

/**
 * `system.ping` — a job that does nothing but log; proves the queue, the worker and the callback into the web app
 * are wired, and is what the development schedule runs.
 */
export const systemPing: JobContract<'system.ping', typeof systemPingSchema> = defineJob({
	name: 'system.ping',
	schema: systemPingSchema,
	options: {
		attempts: 1,
		removeOnComplete: true,
	},
});
