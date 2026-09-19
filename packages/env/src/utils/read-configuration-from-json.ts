import { createRequire } from 'node:module';
import { isPlainObject } from 'lodash-es';

/**
 * Load configuration from a JSON file.
 *
 * Goes through `require` instead of `JSON.parse(readFileSync(...))` so the result is cached by Node like any other
 * module and parse errors carry the file name.
 *
 * @param path - Path to the `.json` file.
 * @returns The configuration object.
 * @throws When the file does not contain a single plain object.
 */
export const readConfigurationFromJson = (path: string): Record<string, unknown> => {
	// 1. A `require` bound to this module, since ESM has no global one
	const require = createRequire(import.meta.url);

	const config = require(path);

	// 2. Arrays and scalars are valid JSON but not valid configuration
	if (isPlainObject(config) === false) {
		throw new Error('JSON configuration file does not contain an object');
	}

	return config as Record<string, unknown>;
};
