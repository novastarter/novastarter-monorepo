/**
 * Tests of `memory/kv/lib/drivers/local` with its real dependencies.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KvDriverLocal } from './local.js';

afterEach(() => {
	// 1. The ttl tests fake timers and `performance.now`; both go back to real, or the next test's LRU would never expire
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe.each([{}, { maxKeys: 100 }, { ttl: 5000 }])('Local KV updates with %j', (config) => {
	test('Retains every concurrent increment and returns distinct counts', async () => {
		// 1. A hundred increments fired at once: the store is synchronous, so none can read a stale count
		const kv = new KvDriverLocal(config);
		const results = await Promise.all(Array.from({ length: 100 }, () => kv.increment('count')));

		expect(results).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
		expect(await kv.get('count')).toBe(100);
	});

	test('Retains concurrent increments with positive, negative, and zero amounts', async () => {
		// 1. Amounts of any sign are applied in call order on top of the stored 10
		const kv = new KvDriverLocal(config);
		await kv.set('count', 10);

		const results = await Promise.all([-3, 5, 0, 2].map((amount) => kv.increment('count', amount)));

		expect(results).toEqual([7, 12, 12, 14]);
		expect(await kv.get('count')).toBe(14);
	});

	test('Rejects smaller and equal concurrent maxima without lowering the stored value', async () => {
		// 1. The first 100 beats the stored 1; the second 100 is equal and the 50 smaller, so both are refused
		const kv = new KvDriverLocal(config);
		await kv.set('maximum', 1);

		const results = await Promise.all([100, 100, 50].map((value) => kv.setMax('maximum', value)));

		expect(results).toEqual([true, false, false]);
		expect(await kv.get('maximum')).toBe(100);
	});

	test('Accepts successively larger concurrent maxima', async () => {
		// 1. Each candidate beats the one before it, so both are stored
		const kv = new KvDriverLocal(config);
		const results = await Promise.all([50, 100].map((value) => kv.setMax('maximum', value)));

		expect(results).toEqual([true, true]);
		expect(await kv.get('maximum')).toBe(100);
	});

	test('Shares the latest value between concurrent setMax and increment calls', async () => {
		// 1. The two helpers read the same bytes, so an increment sees the maximum stored just before it
		const kv = new KvDriverLocal(config);
		await kv.set('count', 1);

		expect(await Promise.all([kv.setMax('count', 100), kv.increment('count')])).toEqual([true, 101]);
		expect(await kv.get('count')).toBe(101);

		// 2. And a maximum sees the increment before it: 102 is not larger than 102
		expect(await Promise.all([kv.increment('count'), kv.setMax('count', 102)])).toEqual([102, false]);
		expect(await kv.get('count')).toBe(102);
	});

	test('Preserves sequential increments and equal-value rejection', async () => {
		// 1. Two bumps from nothing land at 2; a `setMax` of 2 is equal, not larger
		const kv = new KvDriverLocal(config);

		expect(await kv.increment('count')).toBe(1);
		expect(await kv.increment('count')).toBe(2);
		expect(await kv.setMax('count', 2)).toBe(false);
		expect(await kv.get('count')).toBe(2);
	});

	test('Rejects non-number values without overwriting them', async () => {
		// 1. A string under the key is refused by both helpers, and stays what it was
		const kv = new KvDriverLocal(config);
		await kv.set('count', 'not-a-number');

		expect(() => kv.increment('count')).toThrow('The value for key "count" is not an integer.');
		expect(() => kv.setMax('count', 100)).toThrow('The value for key "count" is not a number.');
		expect(await kv.get('count')).toBe('not-a-number');
	});

	test('Rejects a stored null or fraction under increment instead of restarting the counter', async () => {
		// 1. `null` is not a missing key: Redis refuses `INCRBY` on it, so the local store must not count it as zero
		const kv = new KvDriverLocal(config);
		await kv.set('count', null);

		expect(() => kv.increment('count')).toThrow('The value for key "count" is not an integer.');
		expect(await kv.get('count')).toBeNull();

		// 2. A fraction is a number Redis could not increment either; `setMax` compares it fine
		await kv.set('count', 1.5);

		expect(() => kv.increment('count')).toThrow('The value for key "count" is not an integer.');
		expect(await kv.setMax('count', 2)).toBe(true);
		expect(await kv.get('count')).toBe(2);
	});

	test('Refuses a non-integer amount and a non-finite maximum without touching the key', async () => {
		// 1. Both are argument errors, thrown before the store is read or written
		const kv = new KvDriverLocal(config);
		await kv.set('count', 1);

		expect(() => kv.increment('count', 0.5)).toThrow(RangeError);
		expect(() => kv.increment('count', Number.NaN)).toThrow(RangeError);
		expect(() => kv.setMax('count', Number.NaN)).toThrow(RangeError);
		expect(() => kv.setMax('count', Number.POSITIVE_INFINITY)).toThrow(RangeError);
		expect(await kv.get('count')).toBe(1);
	});
});

test.each(['increment', 'setMax'] as const)('%s preserves TTL renewal and expiration', async (operation) => {
	// 1. The LRU reads `performance.now` for expiry and a timer for autopurge; both are driven by hand
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
	const kv = new KvDriverLocal({ ttl: 1000 });
	await kv.set('count', 1);

	// 2. A write halfway through the ttl starts it afresh
	now.mockReturnValue(1500);
	vi.advanceTimersByTime(500);
	await kv[operation]('count', 2);

	// 3. Past the original expiry the key is still there, with the value the write left
	now.mockReturnValue(2100);
	vi.advanceTimersByTime(600);
	expect(await kv.has('count')).toBe(true);
	expect(await kv.setMax('count', operation === 'increment' ? 3 : 2)).toBe(false);
	expect(await kv.setMax('count', 1)).toBe(false);

	// 4. Past the renewed expiry it is gone
	now.mockReturnValue(2601);
	vi.advanceTimersByTime(501);
	expect(await kv.get('count')).toBeUndefined();
});

test('A refused increment leaves the ttl of the key alone', async () => {
	// 1. A string under the key: the refused increment must not count as a write that renews the expiry
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
	const kv = new KvDriverLocal({ ttl: 1000 });
	await kv.set('text', 'not-a-number');

	now.mockReturnValue(1500);
	vi.advanceTimersByTime(500);
	expect(() => kv.increment('text')).toThrow('is not an integer');

	// 2. The key expires when it would have without the refused call
	now.mockReturnValue(2001);
	vi.advanceTimersByTime(501);
	expect(await kv.get('text')).toBeUndefined();
});
