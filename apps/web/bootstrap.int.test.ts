/**
 * Integration test of the app bootstrap on the in-process drivers: the configuration under `config/` is registered
 * on the real managers and a job goes through the real queue. No service is needed — every driver is the in-process
 * one — so the suite always runs.
 */
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
	_state.handlers = false;
	readEnv.reset();
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
	// In-process drivers only: a `REDIS` set in the shell must not make this boot open a real client
	vi.stubEnv('REDIS', '');
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

	// 3. Not booted any more: the next `bootstrap()` registers the locations afresh instead of being a no-op over
	//    quit clients, and keeps the job handlers it registered the first time
	expect(_state.booted).toBe(false);
	bootstrap();
	expect(_state.booted).toBe(true);
	expect(_handlers.has('mail.send')).toBe(true);
});

test('Closes every manager and the Redis clients even when one refuses, then reports the refusal', async () => {
	vi.stubEnv('REDIS', '');
	bootstrap();

	// 1. The mail manager refuses to close; the Redis clients, which close after the managers, and the un-boot must
	//    not be skipped because of it — under a `Promise.all` they would be
	const refusal = new Error('mail refuses');
	vi.spyOn(useMail(), 'close').mockRejectedValue(refusal);
	const redisClose = vi.spyOn(useRedis(), 'close');

	await expect(shutdown()).rejects.toBe(refusal);
	expect(redisClose).toHaveBeenCalledOnce();
	expect(_state.booted).toBe(false);
});

test('Reports several refusals together', async () => {
	vi.stubEnv('REDIS', '');
	bootstrap();

	vi.spyOn(useMail(), 'close').mockRejectedValue(new Error('mail refuses'));
	vi.spyOn(useStorage(), 'close').mockRejectedValue(new Error('storage refuses'));

	// 1. Two refusals make one `AggregateError`, so neither is lost
	const error: unknown = await shutdown().catch((thrown: unknown) => thrown);

	expect(error).toBeInstanceOf(AggregateError);

	expect((error as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual([
		'mail refuses',
		'storage refuses',
	]);

	expect(_state.booted).toBe(false);
});
