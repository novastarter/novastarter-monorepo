/**
 * Tests of `queue/lib/schedule-synchronized-job` on the local `KvDriver` of `@novastarter/memory`; croner runs on
 * fake timers.
 */
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { scheduleSynchronizedJob } from './schedule-synchronized-job.js';
import { SynchronizedClock } from './synchronized-clock.js';

const kv = new KvDriverLocal({});

beforeEach(() => {
	// 1. Fake timers pin "now", so the cron ticks of a test are exact
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
});

afterEach(async () => {
	// 1. Real timers back and the store emptied, so the next test starts from the same blank slate
	vi.useRealTimers();
	await kv.clear();
});

describe('scheduleSynchronizedJob', () => {
	test('Fires the callback once per tick across instances sharing the store', async () => {
		// 1. Two instances race on one store: three seconds pass, so three ticks fire, each exactly once
		const ran: string[] = [];
		const rule = '* * * * * *';

		const first = scheduleSynchronizedJob('test', rule, () => void ran.push('first'), { kv });
		const second = scheduleSynchronizedJob('test', rule, () => void ran.push('second'), { kv });

		await vi.advanceTimersByTimeAsync(3_000);

		expect(ran).toHaveLength(3);

		// 2. Alone, an instance fires every tick; once stopped, no further tick runs anything
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
		// 1. The callback records its fire date and fails on every tick; two seconds pass
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

		// 2. Every tick ran the callback with its fire date, and every failure was reported without stopping the
		//    schedule
		expect(dates).toHaveLength(2);
		expect(dates[0]).toBeInstanceOf(Date);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

		await job.stop();
	});

	test('Refuses a rule croner cannot parse', () => {
		// 1. A rule the scheduler cannot parse is refused where the schedule is created, not on the first tick
		expect(() => scheduleSynchronizedJob('bad', 'every day', () => {}, { kv })).toThrow();
	});

	test('stop() keeps a fired tick claimed so a peer cannot re-run it; reset() forgets the clock', async () => {
		// 1. One tick fires at 12:00:01 and claims 12:00:02 on the shared clock
		const rule = '* * * * * *';
		const job = scheduleSynchronizedJob('guarded', rule, () => {}, { kv });

		await vi.advanceTimersByTimeAsync(1_000);
		await job.stop();

		// 2. The claim survives the stop: a peer racing the same tick is refused — the old `stop()` deleted the clock,
		//    and an instance stopped mid-restart let a peer still running enqueue the tick a second time
		const peer = new SynchronizedClock(`guarded:${rule}`, kv);
		const claimed = Date.parse('2026-09-10T12:00:02.000Z');

		expect(await peer.set(claimed)).toBe(false);

		// 3. Only `reset()` forgets the clock, so the next instance to start begins afresh
		await job.reset();

		expect(await peer.set(claimed)).toBe(true);
	});
});
