/**
 * Check whether bytes are a gzip stream, by looking at the header.
 *
 * Stored values are only compressed above a size threshold, so a reader cannot know up front whether a value was
 * compressed; the gzip magic number tells the two apart without keeping extra metadata.
 *
 * @param array - Bytes read from the store or the bus.
 * @returns `true` when the bytes start with a gzip header.
 */
export const isCompressed = (array: Uint8Array): boolean => {
	// 1. A gzip stream is at least 19 bytes: 10-byte header, 8-byte footer and one byte of payload
	if (array.byteLength < 19) {
		return false;
	}

	// 2. The header opens with the magic number `1f 8b` followed by `08`, the deflate method gzip always uses
	return array[0] === 0x1f && array[1] === 0x8b && array[2] === 0x08;
};
