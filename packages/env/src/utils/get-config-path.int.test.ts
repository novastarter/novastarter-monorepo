/**
 * Integration tests of `env/utils/get-config-path` with the real `node:path` and `node:process` modules.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { getConfigPath } from './get-config-path.js';

/** Working directory the suite started in, restored after each test so a `chdir` cannot leak between files. */
const originalCwd = process.cwd();

/** `CONFIG_PATH` of the developer's shell, restored after each test so the mutation cannot leak outside the file. */
const originalConfigPath = process.env['CONFIG_PATH'];

/** Temporary directory the current test has changed into. */
let directory: string;

beforeEach(() => {
	// A fresh directory per test, so the assertion never depends on what the checkout happens to contain, and no
	// CONFIG_PATH from the developer's shell can leak into it
	directory = mkdtempSync(join(tmpdir(), 'env-get-config-path-'));
	delete process.env['CONFIG_PATH'];
	process.chdir(directory);
});

afterEach(() => {
	// The working directory and the developer's CONFIG_PATH come back, and the temporary directory goes away
	process.chdir(originalCwd);

	if (originalConfigPath === undefined) {
		delete process.env['CONFIG_PATH'];
	} else {
		process.env['CONFIG_PATH'] = originalConfigPath;
	}

	rmSync(directory, { recursive: true, force: true });
});

test('Resolves the default against the working directory at lookup time', () => {
	// The default is relative and resolved on each call, so a chdir between module import and this call cannot
	// pin a stale directory; `process.cwd()` is compared rather than the temp path, because a chdir resolves
	// symlinks and macOS hands `/tmp` out as `/private/tmp`
	expect(getConfigPath()).toBe(join(process.cwd(), '.env'));

	// A relative CONFIG_PATH resolves against the same working directory, behaving like the default
	process.env['CONFIG_PATH'] = 'config/app.yaml';
	expect(getConfigPath()).toBe(join(process.cwd(), 'config/app.yaml'));
});
