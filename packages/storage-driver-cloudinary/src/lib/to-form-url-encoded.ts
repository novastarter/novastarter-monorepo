/**
 * Serialize a payload into an `application/x-www-form-urlencoded` string for use as a request body.
 *
 * The result is decoded again after encoding, so slashes in values (folder paths inside public ids) reach Cloudinary
 * verbatim instead of as `%2F`.
 *
 * @param obj - Payload to serialize.
 * @param options - Serialization options.
 * @param options.sort - Whether to sort entries alphabetically by key.
 * @returns The form-url-encoded string.
 */
export function toFormUrlEncoded(obj: Record<string, string>, options?: { sort: boolean }): string {
	let entries = Object.entries(obj);

	// 1. Sorting is opt-in: request bodies keep insertion order unless the caller needs a canonical form
	if (options?.sort) {
		entries = entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
	}

	// 2. `URLSearchParams` handles the `key=value&...` joining; decoding afterwards keeps slashes in values readable
	return decodeURIComponent(new URLSearchParams(entries).toString());
}
