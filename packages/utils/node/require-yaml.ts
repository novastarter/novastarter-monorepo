import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

/**
 * Read and parse a YAML file synchronously.
 *
 * Synchronous on purpose: it is used while building configuration at startup, before any async machinery exists.
 *
 * @param filepath - Path to the YAML file.
 * @returns Whatever the document parses to; YAML allows scalars and lists at the top level, hence `unknown`.
 * @throws When the file cannot be read or is not valid YAML.
 * @example
 * ```ts
 * const config = requireYaml('./config.yaml');
 * ```
 */
export const requireYaml = (filepath: string): unknown => {
	// 1. Read the whole document as text; YAML has no streaming parser worth the complexity for config files
	const yamlRaw = readFileSync(filepath, 'utf8');

	// 2. `load` (not `loadAll`) parses a single document, which is all a config file holds
	return yaml.load(yamlRaw);
};
