/**
 * Convert a path to forward-slash form, collapsing repeated separators and dropping a trailing one.
 *
 * Windows extended-length prefixes (`\\?\` and `\\.\`) survive as `//?/` and `//./`, so such a path stays
 * addressable after normalisation. `.` and `..` segments are left alone and the filesystem is never touched.
 *
 * @param path - Path in Windows or POSIX form.
 * @param options - `removeLeading` strips the leading slash of an absolute path, which is what object-storage keys
 * expect.
 * @returns The normalised path.
 * @example
 * ```ts
 * normalizePath('C:\\Users\\name\\file.txt');
 * // => 'C:/Users/name/file.txt'
 *
 * normalizePath('/uploads/', { removeLeading: true });
 * // => 'uploads'
 * ```
 */
export const normalizePath = (
	path: string,
	{
		removeLeading,
	}: {
		removeLeading: boolean;
	} = { removeLeading: false },
): string => {
	// 1. A lone separator is the root directory, whichever style it came in — or nothing at all when the leading
	//    slash is to go, the way a storage root of `/` means the top of the bucket
	if (path === '\\' || path === '/') return removeLeading ? '' : '/';

	// 2. Nothing to normalise in an empty or single-character path
	if (path.length <= 1) {
		return path;
	}

	let prefix = '';

	// 3. Keep the Windows `\\?\` / `\\.\` namespace prefix aside: the split below would collapse its double
	//    backslash and turn an extended-length path into a relative one
	if (path.length > 4 && path[3] === '\\') {
		if (['?', '.'].includes(path[2]!) && path.slice(0, 2) === '\\\\') {
			path = path.slice(2);
			prefix = '//';
		}
	}

	// 4. Split on any run of separators, so mixed and doubled slashes collapse into one
	const segments = path.split(/[/\\]+/);

	// 5. A trailing separator leaves an empty last segment; drop it so `a/b/` and `a/b` normalise the same way
	if (segments.at(-1) === '') {
		segments.pop();
	}

	// 6. Nothing but separators — `//`, `/\` — is the root, like the lone separator above, not an empty path
	if (segments.length === 1 && segments[0] === '' && prefix === '') {
		return removeLeading ? '' : '/';
	}

	const normalizedPath = prefix + segments.join('/');

	// 7. Strip the leading slash on request. The check looks at the normalised path, so a backslash-rooted input loses
	//    its slash the same as a forward-slash-rooted one; the `//?/` prefix is not a root and is left alone
	if (removeLeading && prefix === '' && normalizedPath.startsWith('/')) {
		return normalizedPath.substring(1);
	}

	return normalizedPath;
};
