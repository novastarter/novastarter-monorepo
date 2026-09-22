/**
 * Tests of the `file` mail driver against a temporary directory.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { MailDriverFile } from './file.js';

/**
 * Fresh outbox directory per test, inside a temporary parent, so the driver's own `mkdir` is exercised.
 */
let dir: string;

/**
 * The temporary parent `mkdtemp` created, removed whole after each test so nothing is left in the system's temp dir.
 */
let parent: string;

beforeEach(async () => {
	// 1. The outbox lives one level down, so the driver has to create it
	parent = await mkdtemp(join(tmpdir(), 'novastarter-mail-'));
	dir = join(parent, 'outbox');
});

afterEach(async () => {
	// 1. The parent goes with the outbox: `mkdtemp`'s directory is ours to clean up, not the system's
	await rm(parent, { recursive: true, force: true });
});

describe('MailDriverFile', () => {
	test('Writes the complete message as an .eml file, creating the directory', async () => {
		// 1. The directory does not exist yet; the driver creates it on the first send
		const driver = new MailDriverFile({ dir });

		const result = await driver.send({
			to: { name: 'Ada', address: 'ada@example.com' },
			from: 'no-reply@acme.test',
			subject: 'Welcome',
			text: 'Hello Ada',
			html: '<p>Hello Ada</p>',
			attachments: [{ filename: 'hello.txt', content: 'attached', contentType: 'text/plain' }],
		});

		// 2. One file, named by time and message id, and the result points at it
		const files = await readdir(dir);

		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^\d+-.+\.eml$/);
		expect(result).toMatchObject({ accepted: ['ada@example.com'], rejected: [], response: join(dir, files[0]!) });
		expect(result.messageId).toMatch(/^<.+>$/);

		// 3. The file is the complete RFC 822 message, attachment included
		const eml = await readFile(join(dir, files[0]!), 'utf8');

		expect(eml).toContain('Subject: Welcome');
		expect(eml).toContain('To: Ada <ada@example.com>');
		expect(eml).toContain('Hello Ada');
		expect(eml).toContain('filename=hello.txt');
	});

	test('Keeps a message id with path characters inside the directory', async () => {
		const driver = new MailDriverFile({ dir });

		// 1. A caller's `Message-ID` may hold `/` and `..`; both would send `join()` elsewhere, so they become `_`
		const result = await driver.send({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Order',
			text: 'x',
			headers: { 'Message-ID': '<../../order/123@acme.test>' },
		});

		const files = await readdir(dir);

		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^\d+-.._.._order_123_acme\.test\.eml$/);
		expect(result.response).toBe(join(dir, files[0]!));

		// 2. The parent of the outbox got nothing: the file did not escape
		expect(await readdir(join(dir, '..'))).toStrictEqual(['outbox']);
	});

	test('Refuses to start without a directory', () => {
		// 1. The error names the option, so the reader knows what to register
		expect(() => new MailDriverFile({ dir: '' })).toThrow(/"dir"/);
	});
});
