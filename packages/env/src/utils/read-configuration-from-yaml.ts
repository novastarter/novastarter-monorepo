import { requireYaml } from '@novastarter/utils/node';
import { isPlainObject } from 'lodash-es';

/**
 * Load configuration from a YAML file.
 *
 * @param path - Path to the `.yaml` or `.yml` file.
 * @returns The configuration object.
 * @throws When the document is not a single mapping.
 */
export const readConfigurationFromYaml = (path: string): Record<string, unknown> => {
	// 1. Parse the document; YAML permits a scalar or list at the top level, which is checked next
	const config = requireYaml(path);

	// 2. Only a mapping can be configuration
	if (isPlainObject(config) === false) {
		throw new Error('YAML configuration file does not contain an object');
	}

	return config as Record<string, unknown>;
};
