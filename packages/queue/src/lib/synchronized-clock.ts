import type { KvDriver } from '@novastarter/memory';

/**
 * A clock several processes agree on: only the one that advances it past the current reading gets to act.
 *
 * Ported from `api/src/synchronization.ts` of Directus, on top of `KvDriver.setMax()` of `@novastarter/memory` — the
 * `setGreaterThan` of the original (a Lua script on Redis, a comparison in memory). The trick behind synchronised
 * cron: every instance computes the next fire time, tries to write it, and the first write wins; the others see a
 * value that is not greater and stand down.
 */
export class SynchronizedClock {
	/**
	 * Key the reading is stored under, `clock:<id>`.
	 *
	 * @internal
	 */
	private readonly key: string;

	/**
	 * Store shared by every instance, where the reading lives.
	 *
	 * @internal
	 */
	private readonly kv: KvDriver;

	/**
	 * Create a clock over a shared store.
	 *
	 * @param id - What the clock is for; becomes the key.
	 * @param kv - Store shared by every instance — Redis in a cluster, in-process for a single node.
	 */
	constructor(id: string, kv: KvDriver) {
		// 1. Prefixed, so a clock never collides with a value another module stores under the bare id
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
