/**
 * The BullMQ provider and worker against a real Redis; skipped unless `REDIS` names one
 * (`pnpm dev:services` → `REDIS=redis://127.0.0.1:6379`).
 */
import { createRedis } from '@novastarter/redis';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../../contracts/index.js';
import { createWorker } from '../create-worker.js';
import { defineJob } from '../define-job.js';
import { QueueBullmq } from './bullmq.js';

const REDIS = process.env['REDIS'];

describe.skipIf(!REDIS)('QueueBullmq on Redis', () => {
	const prefix = `novastarter-test-${process.pid}`;
	const logger = { info: vi.fn(), error: vi.fn() };
	const contract = defineJob({ name: 'inttest.echo', schema: z.object({ value: z.string() }) });
	let producer: Redis;
	let consumer: Redis;

	// Clients are opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(() => {
		registerJob(contract);
		producer = createRedis(REDIS!, { maxRetriesPerRequest: null });
		consumer = createRedis(REDIS!, { maxRetriesPerRequest: null });
	});

	afterAll(async () => {
		_contracts.delete('inttest.echo');
		await producer.quit();
		await consumer.quit();
	});

	test('A job enqueued by the provider reaches a worker with its payload and context', async () => {
		const provider = new QueueBullmq({ connection: producer, prefix, logger: logger as any });

		const received = new Promise<[unknown, unknown]>((resolve) => {
			void createWorker(
				'inttest',
				async (payload, context) => {
					resolve([payload, context]);
				},
				{ connection: consumer, prefix, logger: logger as any },
			).then((worker) => {
				received.finally(() => worker.close());
			});
		});

		const job = await provider.enqueue(contract, { value: 'hello' }, contract.options, `echo-${Date.now()}`);
		const [payload, context] = await received;

		expect(payload).toStrictEqual({ value: 'hello' });
		expect(context).toMatchObject({ id: job.id, name: 'inttest.echo', attempt: 1 });

		await provider.close();
	}, 15_000);
});
