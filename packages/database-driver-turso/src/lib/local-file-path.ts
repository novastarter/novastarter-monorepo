/**
 * The path of a `file:` URL in libsql's own grammar, `undefined` for a database that lives elsewhere than on disk.
 *
 * libsql parses `file:` URLs itself — `file:relative.db`, `file:/absolute.db`, `file:///absolute.db`, an optional
 * `localhost` host — because the WHATWG `URL` turns `file:./x` into `/x`; the same grammar is read here, so the
 * directory the driver creates is the one libsql opens. A database in memory (`:memory:`, `file::memory:`) and every
 * other scheme (`libsql://`, `https://`, `wss://`) name no path.
 *
 * @param url - The `url` of a location.
 * @returns The path, or `undefined`.
 * @example
 * ```ts
 * const path = localFilePath(config.url);
 *
 * if (path !== undefined) {
 *     ensureDirectory(dirname(path));
 * }
 * ```
 */
export const localFilePath = (url: string): string | undefined => {
	// 1. Only the `file:` scheme names a path; the path ends where a query or a fragment begins
	const match = /^file:(?:\/\/(?:localhost)?)?([^?#]*)/.exec(url);

	if (!match) {
		return undefined;
	}

	// 2. `:memory:` is a database in memory, spelled with or without the scheme
	const path = match[1] ?? '';

	if (path === '' || path === ':memory:') {
		return undefined;
	}

	return path;
};
