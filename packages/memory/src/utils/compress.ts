import { promisify } from 'node:util';
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib';
import { bufferToUint8Array } from './buffer-to-uint8array.js';

/**
 * Promise-based gzip, wrapped once at module load so every call shares the same function.
 *
 * @internal
 */
const gzip = promisify(gzipCallback);

/**
 * Promise-based gunzip, wrapped once at module load so every call shares the same function.
 *
 * @internal
 */
const gunzip = promisify(gunzipCallback);

/**
 * Gzip-compress bytes.
 *
 * @param input - Bytes to compress.
 * @returns Compressed bytes, including the gzip header {@link isCompressed} recognises.
 */
export const compress = async (input: Uint8Array): Promise<Uint8Array<ArrayBufferLike>> => {
	// 1. zlib works with buffers, so convert back to the array type the rest of the package uses
	const buffer = await gzip(input);

	return bufferToUint8Array(buffer);
};

/**
 * Gzip-decompress bytes produced by {@link compress}.
 *
 * @param input - Compressed bytes.
 * @returns Original bytes.
 * @throws When `input` is not valid gzip data.
 */
export const decompress = async (input: Uint8Array): Promise<Uint8Array<ArrayBufferLike>> => {
	// 1. Same round trip as `compress`, in the other direction
	const buffer = await gunzip(input);

	return bufferToUint8Array(buffer);
};
