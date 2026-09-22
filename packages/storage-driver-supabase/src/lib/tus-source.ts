import type { Readable } from 'node:stream';
import * as tus from 'tus-js-client';

/**
 * The file-reader contract of `tus-js-client`, derived from the upload options because the library does not export
 * it by name.
 */
type TusFileReader = NonNullable<tus.UploadOptions['fileReader']>;

/**
 * What {@link TusFileReader.openFile} resolves to: a source the library slices the upload from.
 */
type TusFileSource = Awaited<ReturnType<TusFileReader['openFile']>>;

/**
 * What one {@link TusFileSource.slice} call resolves to.
 */
type TusSliceResult = Awaited<ReturnType<TusFileSource['slice']>>;

/**
 * Stream source that hands `tus-js-client` the incoming chunk exactly once.
 *
 * The library slices its source by absolute upload offsets, but the stream given to `writeChunk` only holds the
 * bytes of one chunk starting at offset zero. This subclass rebases the slice and reports the stream as ended after
 * the first read, so a single chunk maps to a single TUS request.
 *
 * @internal
 */
// @ts-expect-error `StreamSource` is exported at runtime but missing from the library's type declarations
class StreamSource extends tus.StreamSource {
	/**
	 * Whether the one and only slice has been handed out.
	 *
	 * @internal
	 */
	_streamEnded = false;

	/**
	 * Return the chunk once, then report the stream as ended.
	 *
	 * @param start - Absolute upload offset the library asks for.
	 * @param end - Absolute upload offset the slice should end at.
	 * @returns The rebased slice on the first call, an exhausted `{ value: null, done: true }` afterwards — the
	 * shape `tus-js-client` destructures, where a bare `null` crashed its upload loop with a TypeError.
	 */
	// @ts-expect-error the base method is untyped, so the override signature cannot be checked against it
	override async slice(start: number, end: number): Promise<TusSliceResult> {
		// 1. Act like the stream ended after it's been called once
		if (this._streamEnded) {
			// 1. The library destructures `{ value, done }` from the result; a done slice with no value makes it reject
			//    with its own size-mismatch error, while a bare `null` crashed its upload loop with a TypeError
			return { value: null, done: true };
		}

		this._streamEnded = true;

		// 2. Shift the start and end offsets to always start at 0, since the read stream is only a stream of one
		//    chunk with length of `chunkSize`
		return super.slice(0, end - start);
	}
}

/**
 * File reader plugged into `tus-js-client` so it accepts a Node readable as the upload input.
 *
 * @internal
 */
export class FileReader implements TusFileReader {
	/**
	 * Wrap the chunk stream in the one-shot {@link StreamSource}.
	 *
	 * @param input - Chunk stream passed to `tus.Upload`.
	 * @param _ - Chunk size requested by the library; ignored, the stream already holds exactly one chunk.
	 * @returns The source the library slices from.
	 */
	async openFile(input: Readable, _: number): Promise<TusFileSource> {
		// 1. Wrap rather than read: the source slices the stream lazily when the library asks for the chunk
		// @ts-expect-error see `StreamSource`: the constructor is untyped
		return new StreamSource(input);
	}
}
