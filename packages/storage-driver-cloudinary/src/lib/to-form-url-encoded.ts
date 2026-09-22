/**
 * Serialize a payload into an `application/x-www-form-urlencoded` string for use as a request body.
 *
 * Every value is percent-encoded the way a browser form would encode it, so a `+`, `&`, `=` or `%` inside a public id
 * reaches Cloudinary as the character it is. Only the slash is put back verbatim, so folder paths inside public ids
 * stay readable; Cloudinary accepts `/` and `%2F` alike.
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

	// 2. `URLSearchParams` escapes every reserved character, which keeps a `+`, `&`, `=` or `%` in a value from being
	//    read as a space, a separator or a broken escape on the server; decoding the whole string afterwards would undo
	//    exactly that, so only the slash is put back, since it needs no escaping in a body
	return new URLSearchParams(entries).toString().replace(/%2F/gi, '/');
}
