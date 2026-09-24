/**
 * Tests of `env/utils/read-configuration-from-javascript`.
 */
import { createRequire } from 'node:module';
import { isPlainObject } from 'lodash-es';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readConfigurationFromJavaScript } from './read-configuration-from-javascript.js';

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
	// A require double whose default export is an empty factory, and an isPlainObject stub that accepts it, so a
	// test only states what it changes
	mockRequire = vi.fn() as unknown as NodeRequire;
	vi.mocked(mockRequire).mockReturnValue(() => ({}));
	vi.mocked(createRequire).mockReturnValue(mockRequire);
	vi.mocked(isPlainObject).mockReturnValue(true);
});

afterEach(() => {
	// Both the require double and the isPlainObject stub must not leak into the next test
	vi.clearAllMocks();
});

test('Reads file with node require', () => {
	// The whole loader is synchronous require, so the path is handed to require as is
	readConfigurationFromJavaScript('./test/path.js');
	expect(mockRequire).toHaveBeenCalledWith('./test/path.js');
});

test('Executes function if default export is a function type', () => {
	// A factory receives the raw environment, and its result passes the same plain-object check as a data export
	const fn = vi.fn().mockReturnValue({ test: 'foo' });
	vi.mocked(mockRequire).mockReturnValue(fn);
	vi.mocked(isPlainObject).mockReturnValue(true);

	const config = readConfigurationFromJavaScript('./test/path.js');

	expect(fn).toHaveBeenCalledWith(process.env);
	expect(config).toEqual({ test: 'foo' });
});

test('Throws an error if a function export does not return a plain object', () => {
	// A factory returning nothing would otherwise flow into the merge as `undefined`; the loader must refuse it
	// with the same error a bad data export gets
	vi.mocked(mockRequire).mockReturnValue(() => undefined);
	vi.mocked(isPlainObject).mockReturnValue(false);

	expect(() => readConfigurationFromJavaScript('./test/path.js')).toThrowErrorMatchingInlineSnapshot(
		`[NovastarterError: Invalid config. The JavaScript configuration file must export an object or a function returning one, not "undefined".]`,
	);
});

test('Returns exported thing if it is a plain object', () => {
	// A data export is validated and returned by reference, no copy — the merge downstream reads it once
	const config = { test: 'foo' };
	vi.mocked(mockRequire).mockReturnValue(config);

	expect(readConfigurationFromJavaScript('./test/path.js')).toBe(config);
});

test('Returns default key from exported module', () => {
	// ESM-transpiled files nest the export under `default`; that indirection is peeled off before the checks
	const config = { test: 'foo' };
	const mod = { default: config };
	vi.mocked(mockRequire).mockReturnValue(mod);

	expect(readConfigurationFromJavaScript('./test/path.js')).toBe(config);
});

test('Throws an error if the exported value is not a function or plain object', () => {
	// A scalar export names `undefined` because the value never survives the `object` / `function` gate
	vi.mocked(mockRequire).mockReturnValue(123);

	expect(() => readConfigurationFromJavaScript('./test/path.js')).toThrowErrorMatchingInlineSnapshot(
		`[NovastarterError: Invalid config. The JavaScript configuration file must export an object or a function returning one, not "undefined".]`,
	);
});

test('Throws an error instead of crashing when the module exports null', () => {
	// `typeof null` is `object`, so without the null guard the `in` check would crash with a raw TypeError; null
	// must be refused with the same documented error as any other bad export
	vi.mocked(mockRequire).mockReturnValue(null);

	expect(() => readConfigurationFromJavaScript('./test/path.js')).toThrowErrorMatchingInlineSnapshot(
		`[NovastarterError: Invalid config. The JavaScript configuration file must export an object or a function returning one, not "undefined".]`,
	);
});
