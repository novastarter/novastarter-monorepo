/**
 * Tests of `mail/lib/read-attachment` against a temporary file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidPayloadError } from '@novastarter/errors';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readAttachment } from './read-attachment.js';

/**
 * Temporary directory holding the file an attachment may point at.
 */
let dir: string;

beforeEach(async () => {
	// Every test gets a fresh directory, so attachments never read a leftover file
	dir = await mkdtemp(join(tmpdir(), 'novastarter-mail-attachment-'));
});

afterEach(async () => {
	// The directory and every file a test wrote go, so nothing is left in the system's temp dir
	await rm(dir, { recursive: true, force: true });
});

describe('readAttachment', () => {
	test('Answers inline content as bytes, text encoded as UTF-8', async () => {
		const bytes = Buffer.from([1, 2, 3]);

		expect(await readAttachment({ filename: 'a.bin', content: bytes })).toBe(bytes);

		expect(await readAttachment({ filename: 'a.txt', content: 'héllo' })).toStrictEqual(Buffer.from('héllo', 'utf8'));
	});

	test('Reads the file at path when no content is given, content winning over path', async () => {
		const path = join(dir, 'hello.txt');

		await writeFile(path, 'from disk');

		expect((await readAttachment({ filename: 'hello.txt', path })).toString()).toBe('from disk');

		expect((await readAttachment({ filename: 'hello.txt', path, content: 'inline' })).toString()).toBe('inline');
	});

	test('Refuses an attachment with neither content nor path, by file name', async () => {
		await expect(readAttachment({ filename: 'ghost.pdf' })).rejects.toThrow(InvalidPayloadError);
		await expect(readAttachment({ filename: 'ghost.pdf' })).rejects.toThrow('Attachment "ghost.pdf" has neither');
	});
});
