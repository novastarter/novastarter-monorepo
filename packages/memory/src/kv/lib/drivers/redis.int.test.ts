/**
 * The Redis kv driver against a real Redis; skipped unless `REDIS` names one (`REDIS=redis://127.0.0.1:6379`).
 *
 * What the mocked unit tests cannot see: the replies Redis really gives — a Lua `0` or `-1` for `setMax`, a nil for a
 * missing key, an empty `SCAN` batch, the reply error of an `INCRBY` on text — and the round trip of a compressed
 * value.
 */
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { KvDriverRedis } from './redis.js';

/**
 * Address of the Redis to test against, read from the environment; the suite is skipped when it is not set.
 */
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
		// The namespace is emptied before the client quits, so a run leaves nothing behind on a shared Redis
		await kv.clear();
		await redis.quit();
	});

	test('Round-trips values, small and compressed alike, and answers undefined for a missing key', async () => {
		// The 1000-byte value crosses the 16-byte threshold, so it goes through gzip and back
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
		// A refused value must come back as `0`, not `nil`
		expect(await kv.setMax('max', 10)).toBe(true);
		expect(await kv.setMax('max', 5)).toBe(false);
		expect(await kv.setMax('max', 10)).toBe(false);
		expect(await kv.setMax('max', 11)).toBe(true);
		expect(await kv.get('max')).toBe(11);
	});

	test('setMax with a float reads back exactly the number set stores', async () => {
		// A `get` must return exactly what a `set` of the same number returns, not the 17-digit form Lua's number
		// conversion would produce
		await kv.setMax('float-max', 0.1);
		await kv.set('float-set', 0.1);

		expect(await kv.get('float-max')).toBe(0.1);
		expect(await kv.get('float-max')).toBe(await kv.get('float-set'));
	});

	test('increment works on the plain integer a number is stored as', async () => {
		// A number `set` wrote raw is what the script's `INCRBY` reads
		await kv.set('counter', 1);

		expect(await kv.increment('counter')).toBe(2);
		expect(await kv.increment('counter', 5)).toBe(7);
		expect(await kv.increment('fresh-counter')).toBe(1);
	});

	test('increment and setMax refuse a value that is no number with the errors the local store throws', async () => {
		// `INCRBY` answers a reply error and the `setMax` script a `-1`, and both must come out as the shared messages
		await kv.set('text', 'not-a-number');

		await expect(kv.increment('text')).rejects.toThrow('The value for key "text" is not an integer.');
		await expect(kv.setMax('text', 100)).rejects.toThrow('The value for key "text" is not a number.');
		expect(await kv.get('text')).toBe('not-a-number');

		// A stored `null` is refused the same way, not counted as a fresh counter
		await kv.set('nothing', null);

		await expect(kv.increment('nothing')).rejects.toThrow('The value for key "nothing" is not an integer.');
		expect(await kv.get('nothing')).toBeNull();
	});

	test('set stores a non-finite number as null, which get reads back', async () => {
		// Written raw, `NaN` would be text that is not JSON and every `get` would throw until the key is deleted
		await kv.set('nan', Number.NaN);
		await kv.set('infinity', Number.POSITIVE_INFINITY);

		expect(await kv.get('nan')).toBeNull();
		expect(await kv.get('infinity')).toBeNull();
	});

	test('increment and setMax give a key the configured ttl, like set does', async () => {
		// A key created by either write must not live for good
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

	test('A refused increment leaves the ttl of the key alone', async () => {
		// The increment fails inside the script before `PEXPIRE` runs, so the key keeps the expiry `set` gave it
		// instead of a fresh one
		const expiring = new KvDriverRedis({ redis, namespace: `${namespace}-keep`, ttl: 60_000 });

		await expiring.set('text', 'not-a-number');
		await redis.pexpire(`${namespace}-keep:text`, 1_000);

		await expect(expiring.increment('text')).rejects.toThrow('is not an integer');

		const ttl = await redis.pttl(`${namespace}-keep:text`);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(1_000);

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

	test('clear of a namespace holding glob characters drops its own keys and no others', async () => {
		// Unescaped, `tenant[1]:*` would match `tenant1:…` and not `tenant[1]:…`
		const bracketed = new KvDriverRedis({ redis, namespace: `${namespace}-tenant[1]` });
		const lookalike = new KvDriverRedis({ redis, namespace: `${namespace}-tenant1` });

		await bracketed.set('own', 1);
		await lookalike.set('other', 2);

		await bracketed.clear();

		expect(await bracketed.has('own')).toBe(false);
		expect(await lookalike.get('other')).toBe(2);

		await lookalike.clear();
	});

	test('acquireLock can be extended more than once and then released', async () => {
		// Redlock invalidates the lock object on every extend; the handle must keep following the current one
		const lock = await kv.acquireLock('extended');

		await lock.extend(2_000);
		await lock.extend(2_000);
		await lock.release();

		// Released for real: the next holder gets in at once
		const next = await kv.acquireLock('extended');
		await next.release();
	});

	test('A lock and a value under the same name do not collide', async () => {
		// Locking a key that holds a value used to fail after the retry budget, since the lock token went to the same
		// Redis key; the locks live in a namespace of their own now
		await kv.set('shared', { n: 1 });

		await kv.usingLock('shared', async () => {
			expect(await kv.get('shared')).toStrictEqual({ n: 1 });
			await kv.set('shared', { n: 2 });
		});

		expect(await kv.get('shared')).toStrictEqual({ n: 2 });

		// `clear()` empties the store but does not release a lock held under it
		const lock = await kv.acquireLock('held');
		await kv.clear();
		expect(await redis.exists(`${namespace}-locks:held`)).toBe(1);
		await lock.release();
	});

	test('usingLock with a short lock timeout is accepted', async () => {
		// 300 ms is above the 200 ms floor; the extension threshold moves down to make room for it
		const short = new KvDriverRedis({ redis, namespace: `${namespace}-short`, lockTimeout: 300 });

		await expect(short.usingLock('quick', async () => 'done')).resolves.toBe('done');
	});

	test('A lock still held past the budget fails with the error the local store throws', async () => {
		const impatient = new KvDriverRedis({ redis, namespace, lockTimeout: 300 });
		const holder = await kv.acquireLock('busy');

		const error = await impatient.acquireLock('busy').catch((caught: unknown) => caught);
		expect(error).toMatchObject({ message: 'Lock "busy" was not acquired within 300 ms' });
		expect((error as Error).cause).toBeInstanceOf(Error);

		const callback = async (): Promise<string> => 'never';
		await expect(impatient.usingLock('busy', callback)).rejects.toThrow('Lock "busy" was not acquired within 300 ms');

		await holder.release();
	});

	test('usingLock lets one holder in at a time', async () => {
		const order: string[] = [];

		await Promise.all([
			kv.usingLock('lock', async () => {
				// Yields while holding, so a lock that did not exclude would let the second in between
				order.push('a:in');
				await new Promise((resolve) => setTimeout(resolve, 50));
				order.push('a:out');
			}),
			kv.usingLock('lock', async () => {
				// Whichever went first, the two must not interleave
				order.push('b:in');
				order.push('b:out');
			}),
		]);

		expect(order.indexOf('a:out') < order.indexOf('b:in') || order.indexOf('b:out') < order.indexOf('a:in')).toBe(true);
	});
});
