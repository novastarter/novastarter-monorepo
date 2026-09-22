/**
 * Tests of `env/utils/read-configuration-from-json`.
 */
import { createRequire } from 'node:module';
import { isPlainObject } from 'lodash-es';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readConfigurationFromJson } from './read-configuration-from-json.js';

vi.mock('lodash-es');

vi.mock('node:module', async (importOriginal) => {
	const mod = await importOriginal<typeof import('node:module')>();

	return {
		...mod,
		createRequire: vi.fn(),
	};
});

/** Mocked `require`, returned by the mocked `createRequire` so the module under test picks it up. */
let mockRequire: NodeRequire;

beforeEach(() => {
	// 1. A fresh require double per test, so no return value leaks from one test into the next
	mockRequire = vi.fn() as unknown as NodeRequire;

	vi.mocked(createRequire).mockReturnValue(mockRequire);
});

afterEach(() => {
	// 1. Both the require double and the isPlainObject stub must not leak into the next test
	vi.clearAllMocks();
});

test('Reads file with require', () => {
	// 1. require is used instead of readFileSync + JSON.parse, so the path is handed to require as is
	readConfigurationFromJson('./test/path.json');

	expect(mockRequire).toHaveBeenCalledWith('./test/path.json');
});

test('Returns config from JSON file if file contains plain object', () => {
	// 1. A single plain object is the only shape that counts as configuration
	const mockFileContents = { foo: 'bar' };

	vi.mocked(isPlainObject).mockReturnValue(true);

	vi.mocked(mockRequire).mockReturnValue(mockFileContents);

	const config = readConfigurationFromJson('./test/path.json');

	expect(config).toBe(mockFileContents);
});

test('Throws error if JSON file does not contain single plain object', () => {
	// 1. Arrays and scalars are valid JSON but not a key/value configuration, so they are refused loudly
	vi.mocked(isPlainObject).mockReturnValue(false);

	expect(() => readConfigurationFromJson('./test/path.json')).toThrowErrorMatchingInlineSnapshot(
		`[Error: JSON configuration file does not contain an object]`,
	);
});
