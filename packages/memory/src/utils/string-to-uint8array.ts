/**
 * Encoder reused across calls; `TextEncoder` is stateless for UTF-8, so one instance serves every conversion.
 *
 * @internal
 */
const encoder = new TextEncoder();

/**
 * Encode a string as UTF-8 bytes.
 *
 * @param val - Text to encode.
 * @returns UTF-8 encoded bytes.
 */
export const stringToUint8Array = (val: string): Uint8Array => {
	// UTF-8 is the only encoding `TextEncoder` supports and the one every consumer of these bytes expects
	return encoder.encode(val);
};
