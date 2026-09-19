import { toArray } from '@novastarter/utils';
import { camelCase, set } from 'lodash-es';
import { useEnv } from '../lib/use-env.js';

/**
 * Options of {@link getConfigFromEnv}.
 */
export interface GetConfigFromEnvOptions {
	/** Variables starting with any of these prefixes are left out, even though they match `prefix`. */
	omitPrefix?: string | string[];
	/** Variables with exactly these names are left out. */
	omitKey?: string | string[];
	/**
	 * How a variable name is turned into a config key: `camelcase` gives `autoLogging`, `underscore` keeps the
	 * name and lowercases it.
	 *
	 * @defaultValue `'camelcase'`
	 */
	type?: 'camelcase' | 'underscore';
}

/**
 * Collect every environment variable starting with a prefix into one config object.
 *
 * This is how a library's options are set from the environment without a variable per option: `LOGGER_NAME=api`
 * becomes `{ name: 'api' }` for pino, and so on. The prefix is stripped, the rest of the name becomes the key, and a
 * double underscore descends one level, so `DB_POOL__MIN=2` becomes `{ pool: { min: 2 } }`. Matching is
 * case-insensitive; values are passed through as the environment cast them.
 *
 * @param prefix - Start of the variable names to collect, `LOGGER_` for example.
 * @param options - Variables to skip and the key style, see {@link GetConfigFromEnvOptions}.
 * @returns The config object; empty when no variable matched.
 * @example
 * ```ts
 * // LOGGER_HTTP_AUTO_LOGGING=false, LOGGER_HTTP_LOGGER_NAME=http
 * getConfigFromEnv('LOGGER_HTTP', { omitPrefix: 'LOGGER_HTTP_LOGGER' });
 * // => { autoLogging: false }
 * ```
 */
export const getConfigFromEnv = (prefix: string, options: GetConfigFromEnvOptions = {}): Record<string, any> => {
	const env = useEnv();
	const type = options.type ?? 'camelcase';

	// 1. The skip lists accept one name or many; both are compared case-insensitively like the prefix
	const omitPrefixes = toArray(options.omitPrefix ?? []).map((value) => value.toLowerCase());
	const omitKeys = toArray(options.omitKey ?? []).map((value) => value.toLowerCase());

	const config: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		const lowerKey = key.toLowerCase();

		// 2. Only the family under `prefix` is collected
		if (!lowerKey.startsWith(prefix.toLowerCase())) {
			continue;
		}

		// 3. A sub-family or a single variable can be excluded, so `LOGGER_HTTP_*` stays out of the `LOGGER_*` config
		if (omitPrefixes.some((omitPrefix) => lowerKey.startsWith(omitPrefix)) || omitKeys.includes(lowerKey)) {
			continue;
		}

		// 4. A double underscore nests the value; the prefix is only stripped from the first segment
		const segments = key
			.slice(prefix.length)
			.split('__')
			.map((segment) => transformKey(segment, type));

		set(config, segments, value);
	}

	return config;
};

/**
 * Turn one segment of a variable name into a config key.
 *
 * @param segment - Part of the variable name between double underscores, prefix already removed.
 * @param type - Key style requested by the caller.
 * @returns The key.
 * @internal
 */
const transformKey = (segment: string, type: GetConfigFromEnvOptions['type']): string => {
	// 1. `camelcase` also drops the underscore left over from the prefix boundary, so `_AUTO_LOGGING` gives `autoLogging`
	if (type === 'camelcase') {
		return camelCase(segment);
	}

	// 2. `underscore` keeps the name intact for consumers that expect snake_case options
	return segment.toLowerCase();
};
