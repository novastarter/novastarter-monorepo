/**
 * The BullMQ driver and worker against a real Redis; skipped unless `REDIS` names one
 * (`pnpm dev:services` → `REDIS=redis://127.0.0.1:6379`).
 */
import type { Logger } from '@novastarter/logger';
import { createRedis } from '@novastarter/redis';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../../contracts/index.js';
import { createWorker } from '../create-worker.js';
import { defineJob } from '../define-job.js';
import { QueueDriverBullmq } from './bullmq.js';

const REDIS = process.env['REDIS'];

describe.skipIf(!REDIS)('QueueDriverBullmq on Redis', () => {
	const prefix = `novastarter-test-${process.pid}`;
	const logger = { info: vi.fn(), error: vi.fn() };
	const contract = defineJob({ name: 'inttest.echo', schema: z.object({ value: z.string() }) });
	let producer: Redis;
	let consumer: Redis;

	// 1. Clients are opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(() => {
		// 1. The contract must be registered for the run to resolve it from the job name
		registerJob(contract);
		producer = createRedis(REDIS!, { maxRetriesPerRequest: null });
		consumer = createRedis(REDIS!, { maxRetriesPerRequest: null });
	});

	afterAll(async () => {
		// 1. The registry entry goes with the suite, and the clients close so the process can exit
		_contracts.delete('inttest.echo');
		await producer.quit();
		await consumer.quit();
	});

	test('A job enqueued by the driver reaches a worker with its payload and context', async () => {
		// 1. The producer is the driver under test; the worker resolves once a job arrives and closes itself when the
		//    assertion is done with the payload. A failing `createWorker` rejects the promise instead of leaving it
		//    pending, so the real error surfaces instead of the test burning its timeout
		const driver = new QueueDriverBullmq({ connection: producer, prefix, logger: logger as unknown as Logger });

		const received = new Promise<[unknown, unknown]>((resolve, reject) => {
			void createWorker(
				'inttest',
				async (payload, context) => {
					resolve([payload, context]);
				},
				{ connection: consumer, prefix, logger: logger as unknown as Logger },
			).then((worker) => {
				received.finally(() => worker.close());
			}, reject);
		});

		// 2. The job is enqueued on the producer's driver; what the worker received is checked against it
		const job = await driver.enqueue(contract, { value: 'hello' }, contract.options, `echo-${Date.now()}`);
		const [payload, context] = await received;

		expect(payload).toStrictEqual({ value: 'hello' });
		expect(context).toMatchObject({ id: job.id, name: 'inttest.echo', attempt: 1 });

		// 3. The producer's queue closes once the round trip is asserted
		await driver.close();
	}, 15_000);
});
