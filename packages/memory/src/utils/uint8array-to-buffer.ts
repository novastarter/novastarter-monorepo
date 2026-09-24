import { Buffer } from 'node:buffer';

/**
 * Copy a `Uint8Array` into a Node `Buffer`, the type ioredis expects for binary values.
 *
 * @param array - Bytes to wrap.
 * @returns Buffer holding a copy of the bytes.
 */
export const uint8ArrayToBuffer = (array: Uint8Array): Buffer<ArrayBuffer> => {
	// `Buffer.from(Uint8Array)` copies, which keeps the buffer valid even if the array is reused by the caller
	return Buffer.from(array);
};
