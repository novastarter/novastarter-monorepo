/**
 * Tests of `queue/lib/synchronized-clock` and `schedule-synchronized-job` on the local `Kv` of `@novastarter/memory`;
 * croner runs on fake timers.
 */
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { scheduleSynchronizedJob } from './schedule-synchronized-job.js';
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

describe('scheduleSynchronizedJob', () => {
	test('Fires the callback once per tick across instances sharing the store', async () => {
		const ran: string[] = [];
		const rule = '* * * * * *';

		const first = scheduleSynchronizedJob('test', rule, () => void ran.push('first'), { kv });
		const second = scheduleSynchronizedJob('test', rule, () => void ran.push('second'), { kv });

		await vi.advanceTimersByTimeAsync(3_000);

		expect(ran).toHaveLength(3);

		// A lone instance fires every tick
		await first.stop();
		await second.stop();
		ran.length = 0;

		const lone = scheduleSynchronizedJob('test', rule, () => void ran.push('lone'), { kv });

		await vi.advanceTimersByTimeAsync(2_000);
		expect(ran).toStrictEqual(['lone', 'lone']);

		await lone.stop();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(ran).toHaveLength(2);
	});

	test('Hands the fire date to the callback and reports a failing one instead of stopping', async () => {
		const onError = vi.fn();
		const dates: Date[] = [];

		const job = scheduleSynchronizedJob(
			'failing',
			'* * * * * *',
			(fireDate) => {
				dates.push(fireDate);
				throw new Error('boom');
			},
			{ kv, onError },
		);

		await vi.advanceTimersByTimeAsync(2_000);

		expect(dates).toHaveLength(2);
		expect(dates[0]).toBeInstanceOf(Date);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

		await job.stop();
	});

	test('Refuses a rule croner cannot parse', () => {
		expect(() => scheduleSynchronizedJob('bad', 'every day', () => {}, { kv })).toThrow();
	});
});
