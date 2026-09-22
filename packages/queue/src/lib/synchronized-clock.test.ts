/**
 * Tests of `queue/lib/synchronized-clock` on the local `KvDriver` of `@novastarter/memory`; the schedule built on it
 * has its own tests in `schedule-synchronized-job.test.ts`.
 */
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SynchronizedClock } from './synchronized-clock.js';

const kv = new KvDriverLocal({});

beforeEach(() => {
	// 1. Fake timers pin "now", so the clock readings of a test are exact
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
});

afterEach(async () => {
	// 1. Real timers back and the store emptied, so the next test starts from the same blank slate
	vi.useRealTimers();
	await kv.clear();
});

describe('SynchronizedClock', () => {
	test('Lets only the first instance advance the clock to a time', async () => {
		// 1. Two instances race on one store: the first write wins, a later one cannot repeat the reading or move
		//    the clock backwards
		const first = new SynchronizedClock('retention.run', kv);
		const second = new SynchronizedClock('retention.run', kv);

		expect(await first.set(1_000)).toBe(true);
		expect(await second.set(1_000)).toBe(false);
		expect(await second.set(999)).toBe(false);
		expect(await second.set(2_000)).toBe(true);
		expect(await first.set(2_000)).toBe(false);

		// 2. Clocks of different ids do not share a reading
		expect(await new SynchronizedClock('test.ping', kv).set(1_000)).toBe(true);

		// 3. Forgetting the clock lets the next write win again
		await first.reset();
		expect(await second.set(1_000)).toBe(true);
	});
});
