/**
 * Tests of `queue/lib/queue-manager`: the built-in drivers, the default location and `close()`.
 *
 * `@novastarter/logger` and the Redis client of `@novastarter/redis` are mocked.
 */
import { type Logger, useLogger } from '@novastarter/logger';
import { createRedis } from '@novastarter/redis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueueDriverBullmq } from './drivers/bullmq.js';
import { QueueDriverLocal } from './drivers/local.js';
import { useQueue } from './use-queue.js';

vi.mock('@novastarter/logger');

// No Redis is opened in unit tests; the client is a stand-in
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn(() => ({ status: 'ready', quit: vi.fn(async () => 'OK'), disconnect: vi.fn() })),
}));

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ error: vi.fn() } as unknown as Logger);

	// Every test starts from a local default location, as an application without Redis would register it
	useQueue().registerLocation('default', {
		driver: 'local',
		options: {},
	});
});

afterEach(() => {
	useQueue.reset();
	vi.clearAllMocks();
});

describe('QueueManager', () => {
	test('Registers the built-in drivers and serves the default location for any queue', () => {
		// 1. The built-in drivers come with the manager, so the application only registers locations
		expect(useQueue().location('anything')).toBeInstanceOf(QueueDriverLocal);
	});

	test('Builds a bullmq location on its own Redis client and closes every location', async () => {
		useQueue().registerLocation('mail', {
			driver: 'bullmq',
			options: {
				connection: 'redis://jobs',
				prefix: 'acme',
			},
		});

		const mail = useQueue().location('mail');

		expect(mail).toBeInstanceOf(QueueDriverBullmq);
		expect(createRedis).toHaveBeenCalledWith('redis://jobs', { maxRetriesPerRequest: null });
		expect(useQueue().location('reports')).toBeInstanceOf(QueueDriverLocal);

		await useQueue().close();
		expect((mail as QueueDriverBullmq).connection.quit).toHaveBeenCalled();
		expect(useQueue().instantiated().size).toBe(0);
	});

	test('Names the queue when neither its location nor the default one exists', () => {
		useQueue.reset();

		expect(() => useQueue().location('mail')).toThrow('Queue "mail" has no location of its own and no "default" one.');
	});

	test('Refuses a location of a driver nobody registered', () => {
		expect(() =>
			useQueue().registerLocation('x', {
				driver: 'sqs' as 'local',
				options: {},
			}),
		).toThrow(/isn't registered/);
	});
});
