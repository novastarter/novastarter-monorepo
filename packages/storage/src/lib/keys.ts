/**
 * Build the backend prefix a `list()` call queries with, from the full key of the caller's prefix.
 *
 * A folder is asked for with a trailing slash: an empty caller prefix means the whole root, and one that ends in `/`
 * means that folder, so `media` becomes `media/` and does not match `media-archive/…`, whose keys merely share the
 * root as a string. A prefix that names a partial key, such as `av`, is left as it is, since matching `avatars/` and
 * `avatar.png` alike is what the caller asked for.
 *
 * @param fullPrefix - The caller's prefix resolved under the root, the way the driver resolves every path; empty for
 * the top of the bucket.
 * @param prefix - The caller's prefix as given, relative to the root; empty for the whole root.
 * @returns The prefix to list with; empty for the whole bucket.
 * @example
 * ```ts
 * toListPrefix('media', '');
 * // => 'media/'
 *
 * toListPrefix('media/avatars', 'avatars/');
 * // => 'media/avatars/'
 *
 * toListPrefix('av', 'av');
 * // => 'av'
 * ```
 */
export const toListPrefix = (fullPrefix: string, prefix: string): string => {
	// 1. Empty root and prefix give the empty string, the whole bucket; nothing to add a slash to
	if (fullPrefix === '') {
		return '';
	}

	// 2. A folder — the whole root, or a caller prefix ending in `/` — gets its slash back, which path joining drops
	return prefix === '' || prefix.endsWith('/') ? `${fullPrefix}/` : fullPrefix;
};

/**
 * Turn a backend key into the path a caller passes in: the root and its slash removed.
 *
 * What `list()` yields, so a listed path can be handed straight back to `read()` or `delete()`. A key that does not
 * sit under the root is answered with as it came; a prefix built by {@link toListPrefix} never lists one.
 *
 * @param root - The location root, without a trailing slash; empty for the top of the bucket.
 * @param key - The full key the backend reported.
 * @returns The key relative to the root.
 * @example
 * ```ts
 * toRelativePath('media', 'media/avatars/me.png');
 * // => 'avatars/me.png'
 * ```
 */
export const toRelativePath = (root: string, key: string): string => {
	// 1. No root, nothing to strip; a key under the root loses the root and the slash after it
	if (root === '') {
		return key;
	}

	return key.startsWith(`${root}/`) ? key.substring(root.length + 1) : key;
};
