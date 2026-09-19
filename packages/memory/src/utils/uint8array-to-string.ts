/**
 * Decoder reused across calls; a fresh decoder without stream mode carries no state between calls.
 *
 * @internal
 */
const decoder = new TextDecoder();

/**
 * Decode UTF-8 bytes back into a string.
 *
 * @param val - UTF-8 encoded bytes.
 * @returns Decoded text.
 */
export const uint8ArrayToString = (val: Uint8Array): string => {
	// 1. Mirror of `stringToUint8Array`: UTF-8 in, UTF-8 out
	return decoder.decode(val);
};
