/**
 * Tests of `storage-driver-supabase/lib/tus-source`.
 */
import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { FileReader } from './tus-source.js';

/**
 * Build a byte-mode stream holding one chunk, the way the TUS server hands a chunk to `writeChunk`.
 *
 * `Readable.from` defaults to object mode, in which `read(size)` ignores the size and returns the whole buffer;
 * byte mode is what `tus-js-client` slices by length.
 *
 * @param bytes - Chunk contents.
 * @returns A paused readable of exactly those bytes.
 */
function chunkStream(bytes: string): Readable {
	return Readable.from([Buffer.from(bytes)], { objectMode: false });
}

describe('FileReader', () => {
	test('Wraps the stream in a source whose first slice starts at the chunk, whatever the upload offset', async () => {
		// 1. The library asks for absolute upload offsets, here as if this were the third chunk; the stream only holds
		//    the chunk itself, so the slice must be rebased to its start
		const source = await new FileReader().openFile(chunkStream('hello world'), 1024);

		const slice = await source.slice(2048, 2053);

		expect(slice).not.toBeNull();
		expect(Buffer.from(slice.value).toString()).toBe('hello');
	});

	test('Reports the stream as ended on the second slice, so one chunk maps to one TUS request', async () => {
		// 1. After the first slice the library would keep asking for the next range of the "file"; answering `null`
		//    is how the source says there is nothing more, which ends the request after this chunk
		const source = await new FileReader().openFile(chunkStream('hello world'), 1024);

		await source.slice(0, 5);

		await expect(source.slice(5, 11)).resolves.toBeNull();
	});

	test('Ignores the chunk size the library passes, since the stream already holds exactly one chunk', async () => {
		// 1. A chunk size of one byte would make a size-aware reader split the chunk; the slice must still come back
		//    whole, sized by the requested range
		const source = await new FileReader().openFile(chunkStream('hello world'), 1);

		const slice = await source.slice(0, 11);

		expect(Buffer.from(slice.value).toString()).toBe('hello world');
	});
});
