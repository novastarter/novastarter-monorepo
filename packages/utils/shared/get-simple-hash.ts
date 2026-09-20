/**
 * Hash a string into a short hexadecimal digest.
 *
 * A 32-bit multiplicative hash (`hash * 31 + char`, the `String.hashCode` of Java), not a cryptographic one: it is
 * meant for keys and identifiers that have to be short and stable for the same input — a cache key, a deduplication
 * id — never for anything that has to resist collisions on purpose.
 *
 * @param str - Text to hash.
 * @returns Up to eight lower-case hex characters; the same for the same input on every platform.
 * @example
 * ```ts
 * getSimpleHash('hello');
 * // => '5e918d2'
 * ```
 */
export function getSimpleHash(str: string): string {
	let hash = 0;

	// 1. Fold every UTF-16 code unit in, keeping the running value a 32-bit integer so it cannot grow into a float
	for (let index = 0; index < str.length; index++) {
		hash = (hash << 5) - hash + str.charCodeAt(index);
		hash |= 0;
	}

	// 2. Reinterpret as unsigned, so the digest never carries a minus sign
	return (hash >>> 0).toString(16);
}
