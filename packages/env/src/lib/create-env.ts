import { readFileSync } from 'node:fs';
import { toErrorMessage } from '@novastarter/utils';
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
 * A variable of `fileVariables` set both inline and as `<NAME>_FILE` is refused: the sources enumerate in no
 * documented order, so letting the last one win would pick the secret by chance and differ between deployments.
 *
 * @param options - Which variables may come from a file.
 * @returns The configuration, cast prefixes applied.
 * @throws When a variable of `fileVariables` is set both as `<NAME>` and `<NAME>_FILE`, when a `_FILE` variable
 * points to a file that cannot be read (the fs error is the `cause`), or when a value with a cast prefix cannot be
 * read (`number:80O0`); the error names the variable.
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
			const name = removeFileSuffix(key);

			// 4. The plain variable and its `_FILE` twin land under one name, and `process.env` enumerates in the order
			//    the variables were passed, so the survivor would differ between deployments; refuse the pair instead
			//    of picking a secret by chance
			if (Object.hasOwn(rawConfiguration, name)) {
				throw new Error(`Environment variables "${name}" and "${key}" are both set; keep one of them.`);
			}

			try {
				// 5. A cast prefix applies to the file contents, not the path, so it is peeled off and re-applied
				const castFlag = getCastFlag(value);
				const castPrefix = castFlag ? castFlag + ':' : '';
				const filePath = castFlag ? value.replace(castPrefix, '') : value;

				// 6. Read the secret as text
				const fileContent = readFileSync(filePath, { encoding: 'utf8' });

				// 7. Store under the option name and feed the prefix back in, so casting treats it like an inline value
				key = name;
				value = castPrefix + fileContent;
			} catch (error) {
				// 8. The fs error carries the code and path the operator needs (`EACCES`, `ENOENT`), so it stays as the
				//    cause and its message is quoted, while the wrapper adds the variable the fs alone does not know
				throw new Error(
					`Failed to read value from file "${value}", defined in environment variable "${key}": ${toErrorMessage(error)}`,
					{ cause: error },
				);
			}
		}

		// 9. A cast prefix on a source value is applied; everything else is kept as the source gave it. A payload the
		//    prefix cannot read is reported with the variable's name, which the cast alone does not know
		try {
			output[key] = cast(value);
		} catch (error) {
			throw new Error(`Environment variable "${key}": ${toErrorMessage(error)}`, { cause: error });
		}
	}

	return output;
};
