/**
 * Return a shallow copy of the raw process environment.
 *
 * The copy keeps the later merge from mutating `process.env`, which other libraries read directly.
 *
 * @returns Every variable of `process.env`, uncast.
 */
export const readConfigurationFromProcess = (): Record<string, string | undefined> => {
	// 1. Spread into a fresh object, so callers can overwrite keys without touching the real environment; `process.env`
	//    already carries `string | undefined` values, so no further cast is needed
	return { ...process.env };
};
