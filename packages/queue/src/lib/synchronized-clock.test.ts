/**
 * Tests of `queue/lib/synchronized-clock` on the local `KvDriver` of `@novastarter/memory`; the schedule built on it
 * has its own tests in `schedule-synchronized-job.test.ts`.
 */
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SynchronizedClock } from './synchronized-clock.js';

const kv = new KvDriverLocal({});

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
});

afterEach(async () => {
	vi.useRealTimers();
	await kv.clear();
});

describe('SynchronizedClock', () => {
	test('Lets only the first instance advance the clock to a time', async () => {
		const first = new SynchronizedClock('retention.run', kv);
		const second = new SynchronizedClock('retention.run', kv);

		expect(await first.set(1_000)).toBe(true);
		expect(await second.set(1_000)).toBe(false);
		expect(await second.set(999)).toBe(false);
		expect(await second.set(2_000)).toBe(true);
		expect(await first.set(2_000)).toBe(false);

		// Different ids are different clocks
		expect(await new SynchronizedClock('test.ping', kv).set(1_000)).toBe(true);

		await first.reset();
		expect(await second.set(1_000)).toBe(true);
	});
});
