/**
 * Tests of `queue/lib/get-job-id`.
 */
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from './define-job.js';
import { getJobId, JOB_ID_HASH_LENGTH } from './get-job-id.js';

const contract = defineJob({ name: 'billing.sync', schema: z.object({ customer: z.string() }) });

describe('getJobId', () => {
	test('Prefers an explicit id', () => {
		// 1. An explicit id wins over everything, `unique` included
		expect(getJobId(contract, { customer: 'c1' }, { jobId: 'given', unique: true })).toBe('given');
	});

	test('Derives a stable id from the payload for unique jobs', () => {
		// 1. The id names job and payload together: the same payload collapses into the same id across calls, a
		//    different payload gets one of its own
		const first = getJobId(contract, { customer: 'c1' }, { unique: true });

		expect(first).toMatch(new RegExp(`^billing\\.sync_[0-9a-f]{${JOB_ID_HASH_LENGTH}}$`));
		expect(getJobId(contract, { customer: 'c1' }, { unique: true })).toBe(first);
		expect(getJobId(contract, { customer: 'c2' }, { unique: true })).not.toBe(first);
	});

	test('Collapses payloads that hold the same entries in a different key order', () => {
		// 1. Key order is not part of the work: the digest sorts object keys first, so both payloads collapse into
		//    one id, at the top level and nested alike
		const first = getJobId(contract, { a: 1, b: { c: 2, d: 3 } }, { unique: true });

		expect(getJobId(contract, { b: { d: 3, c: 2 }, a: 1 }, { unique: true })).toBe(first);

		// 2. Array order stays significant — it is part of an array's meaning — so a reordered array is different work
		expect(getJobId(contract, { list: ['a', 'b'] }, { unique: true })).not.toBe(
			getJobId(contract, { list: ['b', 'a'] }, { unique: true }),
		);
	});

	test('Tells payloads apart that a 32-bit string hash would fold together', () => {
		// 1. `Aa` and `BB` share a Java-style `h * 31 + c` hash; folded together, the second job would silently be
		//    dropped as a duplicate of the first
		expect(getJobId(contract, { customer: 'Aa' }, { unique: true })).not.toBe(
			getJobId(contract, { customer: 'BB' }, { unique: true }),
		);
	});

	test('Lets a unique function pick the identifying part', () => {
		// 1. The function receives the payload; its answer becomes the identifying part of the id
		expect(getJobId(contract, { customer: 'c1' }, { unique: (payload) => payload.customer })).toBe('billing.sync_c1');
	});

	test('Refuses an id with a colon, which BullMQ reserves for its keys', () => {
		// 1. An id carrying a colon is refused, with the offending id and job in the message
		expect(() => getJobId(contract, { customer: 'a:1' }, { unique: (payload) => payload.customer })).toThrow(
			'The id "billing.sync_a:1" of job "billing.sync" must not contain ":"',
		);

		// 2. The same refusal holds for an explicit jobId
		expect(() => getJobId(contract, { customer: 'c1' }, { jobId: 'x:y' })).toThrow('must not contain ":"');
	});

	test('Hands out a fresh id otherwise', () => {
		// 1. Without `unique` or `jobId` every call gets a fresh UUID, so identical payloads never collapse
		const first = getJobId(contract, { customer: 'c1' }, {});

		expect(first).toMatch(/^[0-9a-f-]{36}$/);
		expect(getJobId(contract, { customer: 'c1' }, {})).not.toBe(first);
	});
});
