import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * Payload of `retention.run`; everything is optional, the environment holds the defaults.
 */
export interface RetentionRunPayload {
	/** Rows deleted per statement, `RETENTION_BATCH` unless given. */
	batch?: number | undefined;
	/** Only these tables, every configured one unless given. */
	tables?: string[] | undefined;
}

/**
 * Schema of a {@link RetentionRunPayload}.
 */
export const retentionRunSchema: z.ZodType<RetentionRunPayload, RetentionRunPayload> = z.object({
	batch: z.number().int().positive().optional(),
	tables: z.array(z.string().min(1)).min(1).optional(),
});

/**
 * `retention.run` — delete expired rows of the system tables in batches, the Directus `retention` schedule.
 *
 * Scheduled nightly (`RETENTION_SCHEDULE`). One try: the next night catches up, and a half-done sweep is harmless.
 * Unique, so a schedule firing while a sweep still runs does not stack a second one.
 */
export const retentionRun: JobContract<'retention.run', typeof retentionRunSchema> = defineJob({
	name: 'retention.run',
	schema: retentionRunSchema,
	options: {
		attempts: 1,
		unique: true,
	},
});
