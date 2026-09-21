/**
 * The Redis kv driver against a real Redis; skipped unless `REDIS` names one (`REDIS=redis://127.0.0.1:6379`).
 *
 * What the mocked unit tests cannot see: the replies Redis really gives — a Lua `0` for `setMax`, a nil for a
 * missing key, an empty `SCAN` batch — and the round trip of a compressed value.
 */
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { KvDriverRedis } from './redis.js';

const REDIS = process.env['REDIS'];

describe.skipIf(!REDIS)('KvDriverRedis on Redis', () => {
	const namespace = `novastarter-test-${process.pid}`;
	let redis: Redis;
	let kv: KvDriverRedis;

	// The client is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(() => {
		redis = new Redis(REDIS!);
		kv = new KvDriverRedis({ redis, namespace, compressionMinSize: 16 });
	});

	afterAll(async () => {
		await kv.clear();
		await redis.quit();
	});

	test('Round-trips values, small and compressed alike, and answers undefined for a missing key', async () => {
		const large = { text: 'x'.repeat(1000) };

		await kv.set('small', { a: 1 });
		await kv.set('large', large);

		expect(await kv.get('small')).toStrictEqual({ a: 1 });
		expect(await kv.get('large')).toStrictEqual(large);
		expect(await kv.get('missing')).toBeUndefined();
		expect(await kv.has('small')).toBe(true);
		expect(await kv.has('missing')).toBe(false);
	});

	test('setMax stores only a larger number and says so truthfully either way', async () => {
		// 1. A fresh key takes any number; a smaller or equal one is refused, which Redis reports as `0`, not `nil`
		expect(await kv.setMax('max', 10)).toBe(true);
		expect(await kv.setMax('max', 5)).toBe(false);
		expect(await kv.setMax('max', 10)).toBe(false);
		expect(await kv.setMax('max', 11)).toBe(true);
		expect(await kv.get('max')).toBe(11);
	});

	test('increment works on the plain integer a number is stored as', async () => {
		await kv.set('counter', 1);

		expect(await kv.increment('counter')).toBe(2);
		expect(await kv.increment('counter', 5)).toBe(7);
		expect(await kv.increment('fresh-counter')).toBe(1);
	});

	test('increment and setMax give a key the configured ttl, like set does', async () => {
		// 1. A store with an expiry: a key created by either write must not live for good
		const expiring = new KvDriverRedis({ redis, namespace: `${namespace}-ttl`, ttl: 60_000 });

		await expiring.increment('counter');
		await expiring.setMax('max', 1);
		await expiring.set('plain', 1);

		for (const key of ['counter', 'max', 'plain']) {
			const ttl = await redis.pttl(`${namespace}-ttl:${key}`);
			expect(ttl).toBeGreaterThan(0);
			expect(ttl).toBeLessThanOrEqual(60_000);
		}

		await expiring.clear();
	});

	test('clear drops every key of the namespace and only those', async () => {
		const other = new KvDriverRedis({ redis, namespace: `${namespace}-other` });

		await kv.set('one', 1);
		await kv.set('two', 2);
		await other.set('kept', true);

		await kv.clear();

		expect(await kv.has('one')).toBe(false);
		expect(await kv.has('two')).toBe(false);
		expect(await other.get('kept')).toBe(true);

		await other.clear();
	});

	test('acquireLock can be extended more than once and then released', async () => {
		// 1. Redlock invalidates the lock object on every extend; the handle must keep following the current one
		const lock = await kv.acquireLock('extended');

		await lock.extend(2_000);
		await lock.extend(2_000);
		await lock.release();

		// 2. Released for real: the next holder gets in at once
		const next = await kv.acquireLock('extended');
		await next.release();
	});

	test('usingLock lets one holder in at a time', async () => {
		// 1. Two callers race for the same lock; the second one must see the first one's write, not run alongside it
		const order: string[] = [];

		await Promise.all([
			kv.usingLock('lock', async () => {
				order.push('a:in');
				await new Promise((resolve) => setTimeout(resolve, 50));
				order.push('a:out');
			}),
			kv.usingLock('lock', async () => {
				order.push('b:in');
				order.push('b:out');
			}),
		]);

		expect(order.indexOf('a:out') < order.indexOf('b:in') || order.indexOf('b:out') < order.indexOf('a:in')).toBe(true);
	});
});
