/**
 * Tests of `queue/lib/get-job-id`.
 */
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from './define-job.js';
import { getJobId } from './get-job-id.js';

const contract = defineJob({ name: 'billing.sync', schema: z.object({ customer: z.string() }) });

describe('getJobId', () => {
	test('Prefers an explicit id', () => {
		expect(getJobId(contract, { customer: 'c1' }, { jobId: 'given', unique: true })).toBe('given');
	});

	test('Derives a stable id from the payload for unique jobs', () => {
		const first = getJobId(contract, { customer: 'c1' }, { unique: true });

		expect(first).toMatch(/^billing\.sync_/);
		expect(getJobId(contract, { customer: 'c1' }, { unique: true })).toBe(first);
		expect(getJobId(contract, { customer: 'c2' }, { unique: true })).not.toBe(first);
	});

	test('Lets a unique function pick the identifying part', () => {
		expect(getJobId(contract, { customer: 'c1' }, { unique: (payload) => payload.customer })).toBe('billing.sync_c1');
	});

	test('Refuses an id with a colon, which BullMQ reserves for its keys', () => {
		expect(() => getJobId(contract, { customer: 'a:1' }, { unique: (payload) => payload.customer })).toThrow(
			'The id "billing.sync_a:1" of job "billing.sync" must not contain ":"',
		);

		expect(() => getJobId(contract, { customer: 'c1' }, { jobId: 'x:y' })).toThrow('must not contain ":"');
	});

	test('Hands out a fresh id otherwise', () => {
		const first = getJobId(contract, { customer: 'c1' }, {});

		expect(first).toMatch(/^[0-9a-f-]{36}$/);
		expect(getJobId(contract, { customer: 'c1' }, {})).not.toBe(first);
	});
});
