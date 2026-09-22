/**
 * Tests of `queue/lib/handlers` on the process registry, reset between tests.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineJob } from './define-job.js';
import { _handlers, getJobHandler, registerJobHandlers } from './handlers.js';

const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }) });

afterEach(() => {
	_handlers.clear();
});

describe('registerJobHandlers', () => {
	test('Registers every handler given, keyed by job name', () => {
		const echo = vi.fn(async () => {});
		const other = vi.fn(async () => {});

		registerJobHandlers({ 'test.echo': echo, 'test.other': other } as any);

		expect(_handlers.get('test.echo')).toBe(echo);
		expect(_handlers.get('test.other')).toBe(other);
	});

	test('Refuses a second handler for the same job', () => {
		registerJobHandlers({ 'test.echo': async () => {} } as any);

		expect(() => registerJobHandlers({ 'test.echo': async () => {} } as any)).toThrow(
			'Job "test.echo" already has a handler',
		);
	});
});

describe('getJobHandler', () => {
	test('Answers the handler of a contract, or undefined when no module registered one', () => {
		expect(getJobHandler(contract)).toBeUndefined();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as any);

		expect(getJobHandler(contract)).toBe(handler);
	});
});
