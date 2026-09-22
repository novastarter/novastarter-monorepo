import { createHash, randomUUID } from 'node:crypto';
import type { EnqueueOptions, JobContract, JobOptions } from '../types.js';

/**
 * What separates the job's name from the identifying part in a derived id.
 *
 * Not `:` — BullMQ builds its Redis keys with it and refuses a custom id that contains one — and not `.` or `-`,
 * which a job name is made of, so the two halves stay apart.
 *
 * @defaultValue `_`
 */
export const JOB_ID_SEPARATOR = '_';

/**
 * Hex characters of the payload digest kept in a derived id.
 *
 * Half of a SHA-256: 128 bits, so two distinct payloads never share an id in practice, while the id stays short
 * enough for a Redis key.
 *
 * @defaultValue 32
 */
export const JOB_ID_HASH_LENGTH = 32;

/**
 * Decide the id of a job before it is enqueued.
 *
 * An explicit `jobId` wins. A `unique` contract derives the id from the payload — a function of the contract's
 * choosing, or a digest of the JSON — so a second enqueue of the same work while the first is still queued, retrying
 * or running collapses into it: the `bullmq` driver hands the id to BullMQ as the deduplication key of the job.
 * Anything else gets a random id.
 *
 * @param contract - The job's contract.
 * @param payload - Parsed payload.
 * @param options - Effective options.
 * @returns The id.
 * @throws Error when a derived or explicit id contains `:`, which BullMQ reserves for its keys — caught here, so the
 * `local` driver of the tests reports it the same way the queue would.
 */
export const getJobId = (contract: JobContract, payload: unknown, options: JobOptions & EnqueueOptions): string => {
	// 1. Explicit, derived or random: which one is the options' business, the check below is every id's
	const id = deriveJobId(contract, payload, options);

	// 2. Refused before any driver sees it, so a `unique` function that leaks a colon fails in tests on the `local`
	//    driver too, not only in production on BullMQ
	if (id.includes(':')) {
		throw new Error(`The id "${id}" of job "${contract.name}" must not contain ":" — BullMQ reserves it`);
	}

	return id;
};

/**
 * The id before the check.
 *
 * @param contract - The job's contract.
 * @param payload - Parsed payload.
 * @param options - Effective options.
 * @returns The id.
 * @internal
 */
const deriveJobId = (contract: JobContract, payload: unknown, options: JobOptions & EnqueueOptions): string => {
	// 1. The caller named the job; nothing is derived
	if (options.jobId) return options.jobId;

	// 2. A custom function knows which fields identify the work — a customer id, say
	if (typeof options.unique === 'function') {
		return `${contract.name}${JOB_ID_SEPARATOR}${options.unique(payload)}`;
	}

	// 3. Otherwise the whole payload identifies it, through a real digest: a 32-bit hash collides between payloads
	//    that differ by little, and a collision here silently drops the second job as a duplicate of the first
	if (options.unique === true) {
		const digest = createHash('sha256')
			.update(JSON.stringify(payload ?? null))
			.digest('hex');

		return `${contract.name}${JOB_ID_SEPARATOR}${digest.slice(0, JOB_ID_HASH_LENGTH)}`;
	}

	// 4. Nothing collapses: every enqueue is its own job
	return randomUUID();
};
