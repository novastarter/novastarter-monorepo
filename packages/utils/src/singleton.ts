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
	 * The arguments belong to the first call: the instance built from them is what every later call answers with,
	 * so a later call must pass none — one that does is refused, since its arguments would be silently ignored.
	 *
	 * @param args - What the builder takes, on the call that builds; none afterwards.
	 * @returns The same instance on every call.
	 * @throws Error when arguments are passed once the instance exists.
	 */
	(...args: Args | []): T;

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
 * every consumer. A later call with arguments throws rather than ignoring them: the one place that knows the
 * arguments calls once, everything else calls with none. The type cannot tell the building call from the later ones,
 * so it allows an empty call throughout; a builder with required arguments checks for them itself and throws a
 * clear error, rather than building from `undefined`. `replace()` swaps in an instance the application built itself;
 * `reset()` drops the instance for tests.
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
 * useEnv({ fileVariables: [] }); // throws: the instance exists, these options would be ignored
 * ```
 */
export const singleton = <T, Args extends unknown[] = []>(build: (...args: Args) => T): Singleton<T, Args> => {
	// 1. Held in a closure rather than a module-level binding, so each accessor keeps its own instance and nothing
	//    but `replace()` and `reset()` can touch it. A flag says whether there is one, rather than the instance being
	//    compared with `undefined`: a builder may well answer with `undefined`, and that answer is kept like any other
	let instance: T | undefined;
	let built = false;

	const use = (...args: Args | []): T => {
		// 1. Build on the first call; a second instance would split the process in two, each half with its own
		//    locations. The call that builds is the one that carries the builder's arguments, which the signature
		//    cannot express — hence the cast
		if (!built) {
			instance = build(...(args as Args));
			built = true;

			return instance as T;
		}

		// 2. Arguments after the build would change nothing: refusing them is what keeps a caller from believing its
		//    options took effect
		if (args.length > 0) {
			throw new Error('singleton: the instance exists already; arguments are only taken by the call that builds it');
		}

		return instance as T;
	};

	// 2. `replace()` and `reset()` ride on the function itself, so a registration or a test goes through the same
	//    import the code uses
	use.replace = (next: T): void => {
		instance = next;
		built = true;
	};

	use.reset = (): void => {
		instance = undefined;
		built = false;
	};

	return use;
};
