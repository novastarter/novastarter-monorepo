import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../constants/defaults.js';
import type { Env } from '../types/env.js';
import { getConfigPath } from '../utils/get-config-path.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { isFileKey } from '../utils/is-file-key.js';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { removeFileSuffix } from '../utils/remove-file-suffix.js';
import { cast } from './cast.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

/**
 * Options of {@link createEnv} and `useEnv()`.
 */
export interface CreateEnvOptions {
	/**
	 * Names of the variables that may be given as `<NAME>_FILE`, a path to read the value from — the way container
	 * platforms mount secrets. The application passes the names of its schema; any other `*_FILE` variable is left
	 * alone, so a third-party `FOO_FILE` is never read as a secret.
	 *
	 * @defaultValue none
	 */
	fileVariables?: readonly string[] | undefined;
}

/**
 * Build the configuration object from defaults, the process environment and the config file.
 *
 * Precedence, lowest to highest: {@link DEFAULTS}, `process.env`, the config file. A variable of `fileVariables`
 * given as `<NAME>_FILE` is replaced by the contents of the file it points to. Values keep the type their source gave
 * them unless they carry a cast prefix; the application's schema turns the strings of the environment into the types
 * it needs.
 *
 * @param options - Which variables may come from a file.
 * @returns The configuration, cast prefixes applied.
 * @throws When a `_FILE` variable points to a file that cannot be read.
 */
export const createEnv = (options: CreateEnvOptions = {}): Env => {
	const fileVariables = new Set(options.fileVariables ?? []);

	// 1. Gather the raw sources; the file is read last so it overrides the process environment
	const baseConfiguration = readConfigurationFromProcess();
	const fileConfiguration = readConfigurationFromFile(getConfigPath());

	const rawConfiguration = { ...baseConfiguration, ...fileConfiguration };

	const output: Env = {};

	// 2. Defaults are authored in their final type already and go in as they are
	for (const [key, value] of Object.entries(DEFAULTS)) {
		output[key] = value;
	}

	for (let [key, value] of Object.entries(rawConfiguration)) {
		// 3. A `*_FILE` variable of the application's schema holds a path, not the value; unknown names are left alone
		//    so a third-party `FOO_FILE` is never read as a secret
		if (isFileKey(key) && fileVariables.has(removeFileSuffix(key)) && typeof value === 'string') {
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

		// 7. A cast prefix on a source value is applied; everything else is kept as the source gave it
		output[key] = cast(value);
	}

	return output;
};
