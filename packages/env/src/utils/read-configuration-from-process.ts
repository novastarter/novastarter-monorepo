/**
 * Return a shallow copy of the raw process environment.
 *
 * The copy keeps the later merge from mutating `process.env`, which other libraries read directly.
 *
 * @returns Every variable of `process.env`, uncast.
 */
export const readConfigurationFromProcess = (): Record<string, any> => {
	// 1. Spread into a fresh object, so callers can overwrite keys without touching the real environment
	return { ...process.env } as Record<string, any>;
};
