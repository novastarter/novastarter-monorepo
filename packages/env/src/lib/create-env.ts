import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../constants/defaults.js';
import type { Env } from '../types/env.js';
import { getConfigPath } from '../utils/get-config-path.js';
import { getDefaultType } from '../utils/get-default-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { isFileKey } from '../utils/is-file-key.js';
import { isNovaVariable } from '../utils/is-nova-variable.js';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { removeFileSuffix } from '../utils/remove-file-suffix.js';
import { cast } from './cast.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

/**
 * Build the configuration object from defaults, the process environment and the config file.
 *
 * Precedence, lowest to highest: {@link DEFAULTS}, `process.env`, the config file. Known variables ending in `_FILE`
 * are replaced by the contents of the file they point to, which is how secrets are mounted by container platforms.
 *
 * @returns The fully cast configuration.
 * @throws When a `_FILE` variable points to a file that cannot be read.
 */
export const createEnv = (): Env => {
	// 1. Gather the raw sources; the file is read last so it overrides the process environment
	const baseConfiguration = readConfigurationFromProcess();
	const fileConfiguration = readConfigurationFromFile(getConfigPath());

	const rawConfiguration = { ...baseConfiguration, ...fileConfiguration };

	const output: Env = {};

	// 2. Defaults are only cast when the type map says so: a default is authored in its final type already, and
	//    guessing would turn a string such as '0' into a number
	for (const [key, value] of Object.entries(DEFAULTS)) {
		output[key] = getDefaultType(key) ? cast(value, key) : value;
	}

	for (let [key, value] of Object.entries(rawConfiguration)) {
		// 3. A known `*_FILE` variable holds a path, not the value; unknown names are left alone so a third-party
		//    `FOO_FILE` is never read as a secret
		if (isFileKey(key) && isNovaVariable(key) && typeof value === 'string') {
			try {
				// 4. A cast prefix applies to the file contents, not the path, so it is peeled off and re-applied
				const castFlag = getCastFlag(value);
				const castPrefix = castFlag ? castFlag + ':' : '';
				const filePath = castFlag ? value.replace(castPrefix, '') : value;

				// 5. Read the secret as text
				const fileContent = readFileSync(filePath, { encoding: 'utf8' });

				// 6. Store under the option name and feed the prefix back in, so casting treats it like an inline value
				key = removeFileSuffix(key);
				value = castPrefix + fileContent;
			} catch {
				throw new Error(`Failed to read value from file "${value}", defined in environment variable "${key}".`);
			}
		}

		// 7. Every source value is cast; the option name drives the type-map lookup
		output[key] = cast(value, key);
	}

	return output;
};
