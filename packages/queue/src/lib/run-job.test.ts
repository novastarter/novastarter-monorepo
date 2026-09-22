/**
 * Tests of `queue/lib/run-job`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import { defineJob } from './define-job.js';
import { _handlers, registerJobHandlers } from './handlers.js';
import { runJob } from './run-job.js';

const context = { id: '1', name: 'test.run', attempt: 1, enqueuedAt: new Date() };

afterEach(() => {
	// 1. Contract and handler of a test are removed together, so the next one starts from the same empty registry
	_contracts.delete('test.run');
	_handlers.delete('test.run');
});

describe('runJob', () => {
	test('parses the payload with the contract and hands it to the registered handler', async () => {
		// 1. Register the contract and its handler, then run the job by name
		const contract = registerJob(defineJob({ name: 'test.run', schema: z.object({ n: z.coerce.number() }) }));
		const handler = vi.fn(async () => undefined);

		registerJobHandlers({ [contract.name]: handler } as never);

		await runJob('test.run', { n: '5' }, context);

		// 2. The handler got the parsed payload — coerced, defaults applied — and the run's context
		expect(handler).toHaveBeenCalledWith({ n: 5 }, context);
	});

	test('refuses an unknown job, a job without a handler, and a payload off the contract', async () => {
		// 1. An unknown job fails before anything runs
		await expect(runJob('nope.run', {}, context)).rejects.toThrow('Job "nope.run" is not registered');

		// 2. A registered job without a handler fails just as clearly
		registerJob(defineJob({ name: 'test.run', schema: z.object({ n: z.number() }) }));

		await expect(runJob('test.run', { n: 1 }, context)).rejects.toThrow('No handler registered for job "test.run"');

		// 3. A payload off the schema is refused with the structured error, before the handler ever sees it
		registerJobHandlers({ 'test.run': vi.fn() } as never);

		await expect(runJob('test.run', { n: 'x' }, context)).rejects.toBeInstanceOf(InvalidPayloadError);
	});
});
