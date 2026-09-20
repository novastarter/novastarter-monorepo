import type { Kv } from '@novastarter/memory';

/**
 * A clock several processes agree on: only the one that advances it past the current reading gets to act.
 *
 * Ported from `api/src/synchronization.ts` of Directus, on top of `Kv.setMax()` of `@novastarter/memory` — the
 * `setGreaterThan` of the original (a Lua script on Redis, a comparison in memory). The trick behind synchronised
 * cron: every instance computes the next fire time, tries to write it, and the first write wins; the others see a
 * value that is not greater and stand down.
 */
export class SynchronizedClock {
	private readonly key: string;

	private readonly kv: Kv;

	/**
	 * @param id - What the clock is for; becomes the key.
	 * @param kv - Store shared by every instance — Redis in a cluster, in-process for a single node.
	 */
	constructor(id: string, kv: Kv) {
		this.key = `clock:${id}`;
		this.kv = kv;
	}

	/**
	 * Advance the clock to a timestamp.
	 *
	 * @param timestamp - Unix milliseconds of the next run.
	 * @returns `true` when this call moved the clock forward — the caller may run; `false` when another instance
	 * got there first.
	 */
	async set(timestamp: number): Promise<boolean> {
		return this.kv.setMax(this.key, timestamp);
	}

	/**
	 * Forget the clock, so the next instance to start begins afresh.
	 */
	async reset(): Promise<void> {
		await this.kv.delete(this.key);
	}
}
