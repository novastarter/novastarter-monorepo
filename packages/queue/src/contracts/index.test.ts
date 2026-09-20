/**
 * Tests of the contract registry and of the kit's own contracts.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobHandlers, JobInput, JobPayload } from '../types.js';
import { systemPing } from './system.js';
import { _contracts, getJobContract, getJobNames, getQueueNames, registerJob } from './index.js';

afterEach(() => {
	_contracts.delete('reports.build');
});

describe('registry', () => {
	test('Holds the contract of the kit at load', () => {
		expect(getJobNames()).toStrictEqual(['system.ping']);
		expect(getQueueNames()).toStrictEqual(['system']);
		expect(getJobContract('system.ping')).toBe(systemPing);
	});

	test('Registers a contract once and refuses a second one of the same name', () => {
		const reportsBuild = defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }) });

		expect(registerJob(reportsBuild)).toBe(reportsBuild);
		expect(getJobContract('reports.build')).toBe(reportsBuild);
		expect(getQueueNames()).toContain('reports');

		expect(() => registerJob(reportsBuild)).toThrow('Job "reports.build" is already registered');
		expect(() => registerJob(defineJob({ name: 'system.ping', schema: z.object({}) }))).toThrow('already registered');
	});

	test('Refuses to look up a name nobody registered', () => {
		expect(() => getJobContract('nope.nope')).toThrow('Job "nope.nope" is not registered');
	});
});

describe('contracts', () => {
	test('Types the payloads of the registry end to end', () => {
		// Compile-time check: the handler map knows the kit's jobs and their parsed payloads
		const handlers: JobHandlers = {
			'system.ping': async (payload) => {
				const message: string = payload.message;
				expect(message).toBeDefined();
			},
		};

		const input: JobInput<typeof systemPing> = {};
		const parsed: JobPayload<typeof systemPing> = { message: 'ping' };

		expect(Object.keys(handlers)).toHaveLength(1);
		expect(input).toStrictEqual({});
		expect(parsed.message).toBe('ping');
	});
});
