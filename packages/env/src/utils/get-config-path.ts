import { resolve } from 'node:path';
import { DEFAULTS } from '../constants/defaults.js';

/**
 * Get the absolute location of the configuration file.
 *
 * `CONFIG_PATH` is read straight from `process.env` rather than from the parsed configuration, because the file it
 * points to has not been loaded yet at this point.
 *
 * @returns The resolved path; defaults to `.env` in the working directory.
 */
export const getConfigPath = (): string => {
	// An empty `CONFIG_PATH` falls back to the default too, hence `||` rather than `??`
	const path = process.env['CONFIG_PATH'] || DEFAULTS['CONFIG_PATH'];

	// Resolve relative to the working directory, so a relative path behaves the same as an absolute one downstream
	return resolve(path as string);
};
