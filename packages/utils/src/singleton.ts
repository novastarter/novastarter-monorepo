/**
 * Accessor of a process-wide instance: builds it on the first call, answers with the same one afterwards.
 *
 * @typeParam T - What the accessor hands out.
 * @typeParam Args - Arguments of the first call, handed to the builder; none for the managers of the kit.
 */
export interface Singleton<T, Args extends unknown[] = []> {
	/**
	 * Return the instance, building it on the first call.
	 *
	 * The arguments count on the first call only: the instance built from them is what every later call answers
	 * with, whatever it is given.
	 *
	 * @param args - What the builder takes.
	 * @returns The same instance on every call.
	 */
	(...args: Args): T;

	/**
	 * Put an instance of the caller's own in place of the built one.
	 *
	 * What a `register*()` of the kit calls with the instance the application built from its configuration —
	 * `registerLogger` — so every later call answers with that one; the instance built so far, if any, is dropped.
	 *
	 * @param instance - What every later call answers with from now on.
	 */
	replace(instance: T): void;

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
 * The builder runs once, on the first call, with that call's arguments, and its result is kept for every later one,
 * so a manager and the locations it holds are shared across the process rather than rebuilt — and reconnected — by
 * every consumer. `replace()` swaps in an instance the application built itself; `reset()` drops the instance for
 * tests.
 *
 * @typeParam T - What the builder makes.
 * @typeParam Args - Arguments of the builder; none for a manager, the options of the first call otherwise.
 * @param build - Called once, on the first call of the accessor, with that call's arguments.
 * @returns The accessor.
 * @example
 * ```ts
 * export const useStorage: Singleton<StorageManager> = singleton(() => new StorageManager());
 *
 * useStorage().registerLocation('uploads', { … });
 * useStorage() === useStorage(); // true
 *
 * export const useEnv: Singleton<Env, [options?: CreateEnvOptions]> = singleton((options) => createEnv(options));
 *
 * useEnv({ fileVariables: ['DB_PASSWORD'] }); // built from these options
 * useEnv(); // the same object, the options of the first call still apply
 * ```
 */
export const singleton = <T, Args extends unknown[] = []>(build: (...args: Args) => T): Singleton<T, Args> => {
	// 1. Held in a closure rather than a module-level binding, so each accessor keeps its own instance and nothing
	//    but `replace()` and `reset()` can touch it
	let instance: T | undefined;

	const use = (...args: Args): T => {
		// 1. Reuse the built instance — a second one would split the process in two, each half with its own locations
		if (instance === undefined) {
			instance = build(...args);
		}

		return instance;
	};

	// 2. `replace()` and `reset()` ride on the function itself, so a registration or a test goes through the same
	//    import the code uses
	use.replace = (next: T): void => {
		instance = next;
	};

	use.reset = (): void => {
		instance = undefined;
	};

	return use;
};
