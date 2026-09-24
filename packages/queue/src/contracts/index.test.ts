/**
 * Tests of the contract registry, which starts empty: every contract is the application's.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobHandler, JobInput, JobPayload } from '../types.js';
import { _contracts, getJobContract, getJobNames, getQueueNames, registerJob } from './index.js';

afterEach(() => {
	// The registry is global state: the contract of a test may not leak into the next one
	_contracts.delete('reports.build');
});

describe('registry', () => {
	test('Starts empty', () => {
		// The registry is per-application: the package ships with nothing registered
		expect(getJobNames()).toStrictEqual([]);
		expect(getQueueNames()).toStrictEqual([]);
	});

	test('Registers a contract once and refuses a second one of the same name', () => {
		const reportsBuild = defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }) });

		expect(registerJob(reportsBuild)).toBe(reportsBuild);
		expect(getJobContract('reports.build')).toBe(reportsBuild);
		expect(getQueueNames()).toContain('reports');

		// A name is taken: the same contract twice or another one under the name is refused
		expect(() => registerJob(reportsBuild)).toThrow('Job "reports.build" is already registered');
		expect(() => registerJob(defineJob({ name: 'reports.build', schema: z.object({}) }))).toThrow('already registered');
	});

	test('Refuses to look up a name nobody registered', () => {
		// A lookup of an unknown name fails the caller instead of answering something they would have to check
		expect(() => getJobContract('nope.nope')).toThrow('Job "nope.nope" is not registered');
	});
});

describe('contracts', () => {
	test('Types the payloads of a contract end to end', () => {
		// Compile-time check: the handler of a contract sees its parsed payload, the caller its input
		const testEcho = defineJob({ name: 'test.echo', schema: z.object({ message: z.string().default('ping') }) });

		// The handler receives the parsed payload: the field is a plain string, no cast needed
		/**
		 * Handler of the contract, typed from it; reads the parsed field as a plain string.
		 *
		 * @param payload - The parsed payload of `test.echo`.
		 */
		const handler: JobHandler<typeof testEcho> = async (payload) => {
			const message: string = payload.message;
			expect(message).toBeDefined();
		};

		// The defaulted field may stay out of the input, and is present in the parsed payload
		const input: JobInput<typeof testEcho> = {};
		const parsed: JobPayload<typeof testEcho> = { message: 'ping' };

		expect(handler).toBeTypeOf('function');
		expect(testEcho.parse(input)).toStrictEqual(parsed);
	});
});
