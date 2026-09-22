/**
 * Tests of `mail/lib/read-attachment` against a temporary file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readAttachment } from './read-attachment.js';

/**
 * Temporary directory holding the file an attachment may point at.
 */
let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'novastarter-mail-attachment-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('readAttachment', () => {
	test('Answers inline content as bytes, text encoded as UTF-8', async () => {
		// 1. A Buffer is handed back as the same instance; nothing to copy
		const bytes = Buffer.from([1, 2, 3]);

		expect(await readAttachment({ filename: 'a.bin', content: bytes })).toBe(bytes);

		// 2. Text becomes UTF-8 bytes, the encoding every provider expects
		expect(await readAttachment({ filename: 'a.txt', content: 'héllo' })).toStrictEqual(Buffer.from('héllo', 'utf8'));
	});

	test('Reads the file at path when no content is given, content winning over path', async () => {
		const path = join(dir, 'hello.txt');

		await writeFile(path, 'from disk');

		// 1. Only a path: the file is read once, here
		expect((await readAttachment({ filename: 'hello.txt', path })).toString()).toBe('from disk');

		// 2. Both given: inline content wins, the file is never touched
		expect((await readAttachment({ filename: 'hello.txt', path, content: 'inline' })).toString()).toBe('inline');
	});

	test('Refuses an attachment with neither content nor path, by file name', async () => {
		// 1. A source-less attachment is a programming error; the name says which one
		await expect(readAttachment({ filename: 'ghost.pdf' })).rejects.toThrow('Attachment "ghost.pdf" has neither');
	});
});
