/**
 * View a Node `Buffer` as a plain `Uint8Array` without copying.
 *
 * The view shares the underlying memory with the buffer, so the result is only as long-lived as the buffer it came
 * from; that is fine here because the value is deserialized or decompressed right away.
 *
 * @param buffer - Node buffer, for example the reply of `redis.getBuffer`.
 * @returns `Uint8Array` over the same bytes.
 */
export const bufferToUint8Array = (buffer: Buffer): Uint8Array<ArrayBufferLike> => {
	// 1. Reuse the buffer's backing store and honour its offset, since Node pools small buffers into one big slab
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};
