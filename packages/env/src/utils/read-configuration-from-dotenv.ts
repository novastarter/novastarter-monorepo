import { readFileSync } from 'node:fs';
import { type DotenvParseOutput, parse } from 'dotenv';

/**
 * Parse a dotenv-style file into a flat string map.
 *
 * Only `parse` is used, not `config`, so nothing is written into `process.env`: merging with the process environment
 * happens later, in one place, with a defined precedence.
 *
 * @param path - Path to the `.env` file.
 * @returns Variables from the file; every value is a string.
 * @throws When the file cannot be read.
 */
export const readConfigurationFromDotEnv = (path: string): DotenvParseOutput => {
	// 1. The raw buffer is enough for dotenv; no need to decode it first
	return parse(readFileSync(path));
};
