/**
 * Serialize a payload into the string Cloudinary signs.
 *
 * Values are kept verbatim (no URL-encoding) so spaces survive, as the signature must match the raw parameter values
 * Cloudinary receives.
 *
 * @param obj - Payload to serialize.
 * @returns The signature string, with entries sorted alphabetically by key.
 * @see https://cloudinary.com/documentation/signatures
 */
export function toSignatureString(obj: Record<string, string>): string {
	// Cloudinary computes the signature over the parameters in alphabetical key order, so the order is fixed here
	// rather than left to the caller
	return Object.entries(obj)
		.sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
		.map(([key, value]) => `${key}=${value}`)
		.join('&');
}
