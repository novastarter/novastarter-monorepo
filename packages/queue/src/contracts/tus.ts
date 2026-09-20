import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * Payload of `tus.cleanup`; nothing to say — the expiration comes from `TUS_UPLOAD_EXPIRATION`.
 */
export type TusCleanupPayload = Record<string, never>;

/**
 * Schema of a {@link TusCleanupPayload}.
 */
export const tusCleanupSchema: z.ZodType<TusCleanupPayload, TusCleanupPayload> = z.object({});

/**
 * `tus.cleanup` — drop the resumable uploads that were abandoned longer ago than `TUS_UPLOAD_EXPIRATION`: their
 * placeholder rows and the partial files behind them — the `tus-cleanup` schedule of Directus.
 *
 * Scheduled on `TUS_CLEANUP_SCHEDULE` while `TUS_ENABLED`. One try: the next run catches up. Unique, so a schedule
 * firing while a sweep still runs does not stack a second one.
 */
export const tusCleanup: JobContract<'tus.cleanup', typeof tusCleanupSchema> = defineJob({
	name: 'tus.cleanup',
	schema: tusCleanupSchema,
	options: {
		attempts: 1,
		unique: true,
	},
});
