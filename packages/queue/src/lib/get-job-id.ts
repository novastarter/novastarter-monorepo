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
 * Deep-copy a payload with the keys of every plain object in sorted order, so `JSON.stringify` writes a canonical
 * text for the same content.
 *
 * `JSON.stringify` writes an object's keys in insertion order, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` — the same
 * work, built in a different order — would digest differently and no longer collapse into one job. Sorting is done on
 * copies: the caller's payload must not be rewritten for a digest. Non-plain values (`Date`, class instances) are
 * left alone to keep their own `JSON.stringify` behaviour, and arrays keep their order, which is part of their
 * meaning.
 *
 * @param value - The payload, or part of it while recursing.
 * @returns A structurally equal value whose plain objects hold their keys in sorted order.
 * @internal
 */
const sortPayloadKeys = (value: unknown): unknown => {
	// Only plain objects are reordered; primitives, `null`, arrays and class instances pass through, so `Date`
	// and friends still serialise through their own `toJSON` exactly as plain `JSON.stringify` has them
	if (typeof value !== 'object' || value === null || Array.isArray(value) || value.constructor !== Object) {
		return value;
	}

	// `JSON.stringify` writes keys in insertion order, so a sorted copy stringifies canonically. Nested objects are
	// sorted the same way, deepest first
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortPayloadKeys((value as Record<string, unknown>)[key])]),
	);
};

/**
 * Serialise a payload to JSON text that is canonical in key order.
 *
 * The digest of a `unique` job must be a function of the payload's content, not of the order the caller happened to
 * build its objects in, so {@link sortPayloadKeys} runs first; an absent payload serialises as `null`, as before.
 *
 * @param payload - The parsed payload.
 * @returns JSON text with every object's keys sorted.
 * @internal
 */
const stableStringify = (payload: unknown): string => {
	// Sorting on a copy, then stringifying: the caller's object is untouched and `undefined` as a whole becomes
	// `null`, matching the digest the id has always had for an absent payload
	return JSON.stringify(sortPayloadKeys(payload) ?? null);
};

/**
 * Decide the id of a job before it is enqueued.
 *
 * An explicit `jobId` wins. A `unique` contract derives the id from the payload — a function of the contract's
 * choosing, or a digest of the payload serialised with object keys sorted, so the same work collapses no matter the
 * order the payload's objects were built in — and a second enqueue of the same work while the first is still queued,
 * retrying or running collapses into it: the `bullmq` driver hands the id to BullMQ as the deduplication key of the
 * job. Anything else gets a random id.
 *
 * @param contract - The job's contract.
 * @param payload - Parsed payload.
 * @param options - Effective options.
 * @returns The id.
 * @throws Error when a derived or explicit id contains `:`, which BullMQ reserves for its keys, or is an integer
 * string such as `"123"` or `"0"`, which BullMQ refuses as a custom id — caught here, so the `local` driver of the
 * tests reports it the same way the queue would.
 */
export const getJobId = (contract: JobContract, payload: unknown, options: JobOptions & EnqueueOptions): string => {
	const id = deriveJobId(contract, payload, options);

	// Refused before any driver sees it, so a `unique` function that leaks a colon fails in tests on the `local`
	// driver too, not only in production on BullMQ
	if (id.includes(':')) {
		throw new Error(`The id "${id}" of job "${contract.name}" must not contain ":" — BullMQ reserves it`);
	}

	// BullMQ refuses a custom id that reads as an integer (`"123"`, `"0"`), since it hands out integer ids itself.
	// Only an explicit id can hit this — derived ids start with the job name and random ones are UUIDs — and
	// `String(order.id)` is a natural pick, so it is refused here rather than only once BullMQ runs in production
	if (`${Number.parseInt(id, 10)}` === id) {
		throw new Error(
			`The id "${id}" of job "${contract.name}" must not be an integer — BullMQ refuses integer custom ids`,
		);
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

	if (typeof options.unique === 'function') {
		return `${contract.name}${JOB_ID_SEPARATOR}${options.unique(payload)}`;
	}

	// Otherwise the whole payload identifies it, through a real digest over a key-sorted serialisation: a 32-bit
	// hash collides between payloads that differ by little, and a collision here silently drops the second job as
	// a duplicate of the first
	if (options.unique === true) {
		const digest = createHash('sha256').update(stableStringify(payload)).digest('hex');

		return `${contract.name}${JOB_ID_SEPARATOR}${digest.slice(0, JOB_ID_HASH_LENGTH)}`;
	}

	return randomUUID();
};
