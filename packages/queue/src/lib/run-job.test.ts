import { InvalidPayloadError } from '@novastarter/errors';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import { defineJob } from './define-job.js';
import { _handlers, registerJobHandlers } from './handlers.js';
import { runJob } from './run-job.js';

const context = { id: '1', name: 'test.run', attempt: 1, enqueuedAt: new Date() };

afterEach(() => {
	_contracts.delete('test.run');
	_handlers.delete('test.run');
});

describe('runJob', () => {
	test('parses the payload with the contract and hands it to the registered handler', async () => {
		const contract = registerJob(defineJob({ name: 'test.run', schema: z.object({ n: z.coerce.number() }) }));
		const handler = vi.fn(async () => undefined);

		registerJobHandlers({ [contract.name]: handler } as never);

		await runJob('test.run', { n: '5' }, context);

		expect(handler).toHaveBeenCalledWith({ n: 5 }, context);
	});

	test('refuses an unknown job, a job without a handler, and a payload off the contract', async () => {
		await expect(runJob('nope.run', {}, context)).rejects.toThrow('Job "nope.run" is not registered');

		registerJob(defineJob({ name: 'test.run', schema: z.object({ n: z.number() }) }));

		await expect(runJob('test.run', { n: 1 }, context)).rejects.toThrow('No handler registered for job "test.run"');

		registerJobHandlers({ 'test.run': vi.fn() } as never);

		await expect(runJob('test.run', { n: 'x' }, context)).rejects.toBeInstanceOf(InvalidPayloadError);
	});
});
