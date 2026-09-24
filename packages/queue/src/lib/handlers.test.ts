/**
 * Tests of `queue/lib/handlers` on the process registry, reset between tests.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import type { JobHandlers } from '../types.js';
import { defineJob } from './define-job.js';
import { _handlers, getJobHandler, registerJobHandlers } from './handlers.js';

const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }) });

afterEach(() => {
	// 1. Handlers are per-application state: whatever one test registered may not leak into the next
	_handlers.clear();
});

describe('registerJobHandlers', () => {
	test('Registers every handler given, keyed by job name', () => {
		// 1. Every entry lands under its job name, so the worker finds the handler of a contract by name
		const echo = vi.fn(async () => {});
		const other = vi.fn(async () => {});

		registerJobHandlers({ 'test.echo': echo, 'test.other': other } as JobHandlers);

		expect(_handlers.get('test.echo')).toBe(echo);
		expect(_handlers.get('test.other')).toBe(other);
	});

	test('Refuses a second handler for the same job', () => {
		// 1. The first registration wins and says so: a second handler for the same job would leave the winner
		//    ambiguous
		registerJobHandlers({ 'test.echo': async () => {} } as JobHandlers);

		expect(() => registerJobHandlers({ 'test.echo': async () => {} } as JobHandlers)).toThrow(
			'Job "test.echo" already has a handler',
		);
	});
});

describe('getJobHandler', () => {
	test('Answers the handler of a contract, or undefined when no module registered one', () => {
		// 1. Before any registration the lookup answers undefined rather than throwing
		expect(getJobHandler(contract)).toBeUndefined();

		// 2. After registration the very function that was registered is answered
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		expect(getJobHandler(contract)).toBe(handler);
	});
});
