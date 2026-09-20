/**
 * Tests of the contract registry, which starts empty: every contract is the application's.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobHandler, JobInput, JobPayload } from '../types.js';
import { _contracts, getJobContract, getJobNames, getQueueNames, registerJob } from './index.js';

afterEach(() => {
	_contracts.delete('reports.build');
});

describe('registry', () => {
	test('Starts empty', () => {
		expect(getJobNames()).toStrictEqual([]);
		expect(getQueueNames()).toStrictEqual([]);
	});

	test('Registers a contract once and refuses a second one of the same name', () => {
		const reportsBuild = defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }) });

		expect(registerJob(reportsBuild)).toBe(reportsBuild);
		expect(getJobContract('reports.build')).toBe(reportsBuild);
		expect(getQueueNames()).toContain('reports');

		expect(() => registerJob(reportsBuild)).toThrow('Job "reports.build" is already registered');
		expect(() => registerJob(defineJob({ name: 'reports.build', schema: z.object({}) }))).toThrow('already registered');
	});

	test('Refuses to look up a name nobody registered', () => {
		expect(() => getJobContract('nope.nope')).toThrow('Job "nope.nope" is not registered');
	});
});

describe('contracts', () => {
	test('Types the payloads of a contract end to end', () => {
		// Compile-time check: the handler of a contract sees its parsed payload, the caller its input
		const testEcho = defineJob({ name: 'test.echo', schema: z.object({ message: z.string().default('ping') }) });

		const handler: JobHandler<typeof testEcho> = async (payload) => {
			const message: string = payload.message;
			expect(message).toBeDefined();
		};

		const input: JobInput<typeof testEcho> = {};
		const parsed: JobPayload<typeof testEcho> = { message: 'ping' };

		expect(handler).toBeTypeOf('function');
		expect(testEcho.parse(input)).toStrictEqual(parsed);
	});
});
