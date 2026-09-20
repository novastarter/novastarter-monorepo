import { randomUUID } from 'node:crypto';
import { getSimpleHash } from '@novastarter/utils';
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
 * Decide the id of a job before it is enqueued.
 *
 * An explicit `jobId` wins. A `unique` contract derives the id from the payload — a function of the contract's
 * choosing, or a hash of the JSON — so a second enqueue of the same work while the first is still queued collapses
 * into it (BullMQ ignores a job whose id is already there). Anything else gets a random id.
 *
 * @param contract - The job's contract.
 * @param payload - Parsed payload.
 * @param options - Effective options.
 * @returns The id.
 * @throws Error when a derived or explicit id contains `:`, which BullMQ reserves for its keys — caught here, so the
 * `local` provider of the tests reports it the same way the queue would.
 */
export const getJobId = (contract: JobContract, payload: unknown, options: JobOptions & EnqueueOptions): string => {
	const id = deriveJobId(contract, payload, options);

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
	if (options.jobId) return options.jobId;

	// 1. A custom function knows which fields identify the work — a customer id, say
	if (typeof options.unique === 'function') {
		return `${contract.name}${JOB_ID_SEPARATOR}${options.unique(payload)}`;
	}

	// 2. Otherwise the whole payload identifies it; the hash keeps the id short enough for a Redis key
	if (options.unique === true) {
		return `${contract.name}${JOB_ID_SEPARATOR}${getSimpleHash(JSON.stringify(payload ?? null))}`;
	}

	return randomUUID();
};
