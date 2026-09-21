/**
 * Accessor of a process-wide instance: builds it on the first call, answers with the same one afterwards.
 *
 * @typeParam T - What the accessor hands out.
 */
export interface Singleton<T> {
	/**
	 * Return the instance, building it on the first call.
	 *
	 * @returns The same instance on every call.
	 */
	(): T;

	/**
	 * Drop the instance, so the next call builds a fresh one.
	 *
	 * For tests that need a clean slate between cases; application code never calls it.
	 */
	reset(): void;
}

/**
 * Make a process-wide accessor — the `use*()` of every manager of the kit — from a builder.
 *
 * The builder runs once, on the first call, and its result is kept for every later one, so a manager and the
 * locations it holds are shared across the process rather than rebuilt — and reconnected — by every consumer.
 * `reset()` drops the instance for tests.
 *
 * @typeParam T - What the builder makes.
 * @param build - Called once, on the first call of the accessor.
 * @returns The accessor.
 * @example
 * ```ts
 * export const useStorage: Singleton<StorageManager> = singleton(() => new StorageManager());
 *
 * useStorage().registerLocation('uploads', { … });
 * useStorage() === useStorage(); // true
 * ```
 */
export const singleton = <T>(build: () => T): Singleton<T> => {
	// 1. Held in a closure rather than a module-level binding, so each accessor keeps its own instance and nothing
	//    but `reset()` can touch it
	let instance: T | undefined;

	const use = (): T => {
		// 1. Reuse the built instance — a second one would split the process in two, each half with its own locations
		if (instance === undefined) {
			instance = build();
		}

		return instance;
	};

	// 2. `reset()` rides on the function itself, so a test resets through the same import the code uses
	use.reset = (): void => {
		instance = undefined;
	};

	return use;
};
