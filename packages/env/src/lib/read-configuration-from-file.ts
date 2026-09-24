import { existsSync } from 'node:fs';
import { JAVASCRIPT_FILE_EXTS } from '@novastarter/constants';
import { isIn } from '@novastarter/utils';
import { getFileExtension } from '../utils/get-file-extension.js';
import { readConfigurationFromDotEnv } from '../utils/read-configuration-from-dotenv.js';
import { readConfigurationFromJavaScript } from '../utils/read-configuration-from-javascript.js';
import { readConfigurationFromJson } from '../utils/read-configuration-from-json.js';
import { readConfigurationFromYaml } from '../utils/read-configuration-from-yaml.js';

/**
 * Read configuration variables from the config file, picking the reader by file extension.
 *
 * A missing file is not an error: configuring everything through the process environment is a supported setup.
 *
 * @param path - Absolute path of the config file.
 * @returns The variables from the file, or `null` when the file does not exist.
 */
export const readConfigurationFromFile = (path: string): Record<string, unknown> | null => {
	// No file means "nothing to merge", not a failure
	if (existsSync(path) === false) {
		return null;
	}

	// JS, JSON and YAML each need their own parser
	const ext = getFileExtension(path);

	if (isIn(ext, JAVASCRIPT_FILE_EXTS)) {
		return readConfigurationFromJavaScript(path);
	}

	if (ext === 'json') {
		return readConfigurationFromJson(path);
	}

	if (isIn(ext, ['yaml', 'yml'] as const)) {
		return readConfigurationFromYaml(path);
	}

	// Anything else, including the extension-less `.env`, is dotenv syntax
	return readConfigurationFromDotEnv(path);
};
