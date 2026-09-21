/**
 * Integration test of the app bootstrap on the in-process drivers: the configuration under `config/` is registered
 * on the real managers and a job goes through the real queue.
 */
import { useEnv } from '@novastarter/env';
import { useMail } from '@novastarter/mail';
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { _handlers, enqueue, QueueDriverLocal, registerJobHandlers, useQueue } from '@novastarter/queue';
import { useRedis } from '@novastarter/redis';
import { useStorage } from '@novastarter/storage';
import { afterEach, expect, test, vi } from 'vitest';
import { _state, bootstrap, shutdown } from './bootstrap';
import { readEnv } from './env';

afterEach(() => {
	_state.booted = false;
	readEnv.reset();
	useEnv.reset();
	useQueue.reset();
	useRedis.reset();
	useStorage.reset();
	useMail.reset();
	_handlers.clear();
	useKv.reset();
	useCache.reset();
	useBus.reset();
	useLimiter.reset();
	vi.unstubAllEnvs();
});

test('Registers every subsystem in-process without a Redis and runs a job end to end', async () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('STORAGE_LOCAL_ROOT', './uploads');
	vi.stubEnv('MAIL_FROM', 'no-reply@acme.test');

	const env = bootstrap();

	expect(env.NODE_ENV).toBe('test');
	expect(useRedis().locationNames()).toEqual([]);
	expect(useStorage().hasLocation('default')).toBe(true);
	expect(useQueue().location('anything')).toBeInstanceOf(QueueDriverLocal);
	expect(useMail().hasLocation('default')).toBe(true);
	expect(useMail().routes().from).toBe('no-reply@acme.test');

	const sent = await enqueue('mail.send', { to: 'ada@example.com', subject: 'Boot', text: 'Hello' });

	expect(sent.queue).toBe('mail');
	expect(useMail().instantiated().has('default')).toBe(true);

	// The bootstrap registered the app's ping handler; a spy takes its place to see the payload arrive
	expect(_handlers.has('system.ping')).toBe(true);
	_handlers.delete('system.ping');

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

test('Shuts every manager down, leaving the registrations for a later boot', async () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('MAIL_FROM', 'no-reply@acme.test');

	bootstrap();

	// 1. A job through the local queue builds the queue and mail locations; the rest stay unbuilt
	await enqueue('mail.send', { to: 'ada@example.com', subject: 'Bye', text: 'Hello' });
	expect(useQueue().instantiated().size).toBe(1);
	expect(useMail().instantiated().size).toBe(1);

	await shutdown();

	// 2. Every manager let its instances go, and still knows its locations
	expect(useQueue().instantiated().size).toBe(0);
	expect(useMail().instantiated().size).toBe(0);
	expect(useStorage().instantiated().size).toBe(0);
	expect(useKv().instantiated().size).toBe(0);
	expect(useMail().hasLocation('default')).toBe(true);
	expect(useStorage().hasLocation('default')).toBe(true);
});
