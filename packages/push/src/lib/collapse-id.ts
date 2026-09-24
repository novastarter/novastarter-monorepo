/**
 * Longest collapse id a push service accepts: APNs's `apns-collapse-id` limit, in bytes. FCM relays the header to
 * APNs as given, so its limit is the same.
 *
 * @defaultValue 64 bytes.
 */
export const COLLAPSE_ID_MAX_LENGTH = 64;

/**
 * A collapse tag as the push services take it: at most {@link COLLAPSE_ID_MAX_LENGTH} bytes of letters, digits and
 * `_ . : -`.
 *
 * Both token platforms funnel the tag into APNs's `apns-collapse-id`, so one sanitising serves both. The header goes
 * out verbatim — the HTTP client refuses a value outside Latin-1 before the request leaves — and Apple's limit is
 * bytes, not characters; every code point outside the safe alphabet becomes one `_` (the `u` flag keeps an emoji
 * from turning into two), which leaves pure ASCII, where a character is a byte and the cut can split no code point.
 *
 * @param tag - Free text.
 * @returns The sanitised tag, cut to the limit; `undefined` for an empty one.
 * @example
 * ```ts
 * toCollapseId('invoice.paid:42');
 * // => 'invoice.paid:42'
 *
 * toCollapseId('счёт-42');
 * // => '____-42'
 * ```
 */
export const toCollapseId = (tag: string | undefined): string | undefined => {
	if (!tag) return undefined;

	// Sanitised before the cut: the result is ASCII, so the character cut is a byte cut on a character boundary
	return tag.replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, COLLAPSE_ID_MAX_LENGTH);
};
