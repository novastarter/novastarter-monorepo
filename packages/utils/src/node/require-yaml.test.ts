/**
 * Tests of `utils/node/require-yaml`: the file is read synchronously and parsed as one YAML document.
 */
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { requireYaml } from './require-yaml.js';

vi.mock('node:fs');

afterEach(() => {
	vi.resetAllMocks();
});

test('Reads the file as UTF-8 text and parses the document', () => {
	// The path goes to `readFileSync` as given, with the encoding, so a Buffer never reaches the parser
	vi.mocked(readFileSync).mockReturnValue('database:\n  host: localhost\n  port: 5432\n');

	expect(requireYaml('./config.yaml')).toEqual({ database: { host: 'localhost', port: 5432 } });
	expect(readFileSync).toHaveBeenCalledExactlyOnceWith('./config.yaml', 'utf8');
});

test('Answers with whatever the top level of the document is', () => {
	// YAML allows a scalar, a list or nothing at the top level; none of those is turned into an object
	vi.mocked(readFileSync).mockReturnValueOnce('- a\n- b\n');
	expect(requireYaml('list.yaml')).toEqual(['a', 'b']);

	vi.mocked(readFileSync).mockReturnValueOnce('42\n');
	expect(requireYaml('scalar.yaml')).toBe(42);

	vi.mocked(readFileSync).mockReturnValueOnce('');
	expect(requireYaml('empty.yaml')).toBeUndefined();
});

test('Throws when the file cannot be read', () => {
	// A missing config file is a startup failure; the error comes out as the filesystem raised it
	vi.mocked(readFileSync).mockImplementation(() => {
		throw new Error('ENOENT: no such file or directory');
	});

	expect(() => requireYaml('missing.yaml')).toThrow('ENOENT');
});

test('Throws when the text is not valid YAML or holds more than one document', () => {
	// A config file is one document: `load` rejects a multi-document stream, which `loadAll` would accept
	vi.mocked(readFileSync).mockReturnValueOnce('key: [unclosed\n');
	expect(() => requireYaml('broken.yaml')).toThrow();

	vi.mocked(readFileSync).mockReturnValueOnce('a: 1\n---\nb: 2\n');
	expect(() => requireYaml('multi.yaml')).toThrow();
});
