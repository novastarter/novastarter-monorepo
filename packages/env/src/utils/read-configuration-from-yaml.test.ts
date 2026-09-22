/**
 * Tests of `env/utils/read-configuration-from-yaml`.
 */
import { requireYaml } from '@novastarter/utils/node';
import { isPlainObject } from 'lodash-es';
import { expect, test, vi } from 'vitest';
import { readConfigurationFromYaml } from './read-configuration-from-yaml.js';

vi.mock('@novastarter/utils/node');
vi.mock('lodash-es');

test('Returns yaml from given path if it contains a plain object', () => {
	// 1. A single plain object is the only shape that counts as configuration, passed on by reference
	const config = { test: 'foo' };

	vi.mocked(requireYaml).mockReturnValue(config);
	vi.mocked(isPlainObject).mockReturnValue(true);

	const output = readConfigurationFromYaml('./test/path/yaml');

	expect(output).toBe(config);
});

test('Throws error if yaml does not contain a plain object', () => {
	// 1. A YAML list or scalar is not a key/value configuration, so it is refused loudly
	vi.mocked(isPlainObject).mockReturnValue(false);

	expect(() => readConfigurationFromYaml('./test/path.yaml')).toThrowErrorMatchingInlineSnapshot(
		`[Error: YAML configuration file does not contain an object]`,
	);
});
