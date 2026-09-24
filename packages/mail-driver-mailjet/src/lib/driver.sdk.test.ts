/**
 * Tests of the Mailjet driver on the real `node-mailjet`, seen the way Node's ESM loader sees it. The SDK is CommonJS
 * and Vitest adds named exports to such a module that Node does not, so a named import that breaks the built package
 * would pass a plain test; here the module keeps only the exports Node detects.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';
import { MailDriverMailjet } from './driver.js';

vi.mock('node-mailjet', () => {
	// Node's own loader, in a child process, names the exports it gives the CommonJS module; Vitest's cannot tell
	const script = "import('node-mailjet').then((module) => console.log(JSON.stringify(Object.keys(module))))";

	const names = JSON.parse(
		execFileSync(process.execPath, ['--input-type=module', '-e', script], {
			cwd: import.meta.dirname,
			encoding: 'utf8',
		}),
	) as string[];

	// The values are the real SDK's: `module.exports` as the default, its properties under the detected names
	const sdk = createRequire(import.meta.url)('node-mailjet') as Record<string, unknown>;

	return Object.fromEntries(
		names.map((name) => [name, name === 'default' || name === 'module.exports' ? sdk : sdk[name]]),
	);
});

describe('MailDriverMailjet on the real SDK', () => {
	test('Builds its client from the CommonJS node-mailjet', () => {
		expect(() => new MailDriverMailjet({ apiKey: 'key', apiSecret: 'secret' })).not.toThrow();
	});
});
