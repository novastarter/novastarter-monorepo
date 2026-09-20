/**
 * Integration test of the app bootstrap on the in-process drivers: the configuration under `config/` is registered
 * on the real managers and a job goes through the real queue.
 */
import { _cache as memoryCache } from '@novastarter/memory';
import { enqueue, _cache as queueCache, registerJobHandlers, useQueue } from '@novastarter/queue';
import { _cache as redisCache, useRedis } from '@novastarter/redis';
import { _cache as storageCache, useStorage } from '@novastarter/storage';
import { afterEach, expect, test, vi } from 'vitest';
import { _state, bootstrap } from './bootstrap';

afterEach(() => {
	_state.booted = false;
	queueCache.queue = undefined;
	redisCache.redis = undefined;
	storageCache.storage = undefined;
	memoryCache.kv = memoryCache.cache = memoryCache.bus = memoryCache.limiter = undefined;
	vi.unstubAllEnvs();
});

test('Registers every subsystem in-process without a Redis and runs a job end to end', async () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('STORAGE_LOCAL_ROOT', './uploads');

	const env = bootstrap();

	expect(env.NODE_ENV).toBe('test');
	expect(useRedis().locationNames()).toEqual([]);
	expect(useStorage().hasLocation('default')).toBe(true);
	expect(useQueue().location('anything').type).toBe('local');

	const handler = vi.fn(async () => {});
	registerJobHandlers({ 'system.ping': handler });

	const job = await enqueue('system.ping', { message: 'boot' });

	expect(job.queue).toBe('system');
	expect(handler).toHaveBeenCalledWith({ message: 'boot' }, expect.objectContaining({ id: job.id }));
});

test('Boots once per process', () => {
	bootstrap();

	const first = useQueue();
	bootstrap();

	expect(useQueue()).toBe(first);
});
