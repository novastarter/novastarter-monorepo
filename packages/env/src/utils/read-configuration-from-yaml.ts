import { InvalidConfigError } from '@novastarter/errors';
import { requireYaml } from '@novastarter/utils/node';
import { isPlainObject } from 'lodash-es';

/**
 * Load configuration from a YAML file.
 *
 * @param path - Path to the `.yaml` or `.yml` file.
 * @returns The configuration object.
 * @throws InvalidConfigError when the document is not a single mapping.
 */
export const readConfigurationFromYaml = (path: string): Record<string, unknown> => {
	// YAML permits a scalar or list at the top level, which is checked next
	const config = requireYaml(path);

	// Only a mapping can be configuration
	if (isPlainObject(config) === false) {
		throw new InvalidConfigError({ reason: 'The YAML configuration file must hold a single object' });
	}

	return config as Record<string, unknown>;
};
