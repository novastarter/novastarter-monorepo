import { normalizePath } from './normalize-path.js';

/**
 * Join path segments with forward slashes and resolve `.` and `..`, whatever the platform.
 *
 * What `path.posix.join` does, without `node:path`, so an object-storage key or a URL path is built the same way on
 * every platform and in the browser. Empty segments are skipped, backslashes and repeated separators are collapsed
 * through {@link normalizePath}, and `.` and `..` segments are resolved: in an absolute path a `..` that would climb
 * above the root is dropped, in a relative one it stays at the front. A trailing slash is removed; no segments at
 * all, or only empty and `.` ones, give an empty string.
 *
 * Not for filesystem paths: only a leading `/` is a root, so a Windows drive (`C:`) or UNC root is an ordinary
 * segment a `..` can pop. `node:path` knows those.
 *
 * @param segments - Key or URL path parts.
 * @returns The joined, normalised path.
 * @example
 * ```ts
 * joinPath('uploads', 'avatars', 'me.png');
 * // => 'uploads/avatars/me.png'
 *
 * joinPath('/root', '../etc', './passwd');
 * // => '/etc/passwd'
 *
 * joinPath('a', '..', '..', 'b');
 * // => '../b'
 * ```
 */
export const joinPath = (...segments: string[]): string => {
	// 1. Skip empty parts, so `joinPath('', 'a')` and `joinPath('a')` are the same path; nothing left means no path
	const parts = segments.filter((segment) => segment !== '');

	if (parts.length === 0) {
		return '';
	}

	// 2. Collapse separators and backslashes first, so the split below only ever sees single forward slashes
	const joined = normalizePath(parts.join('/'));

	// 3. Remember whether the path is rooted: the root must survive resolution and bounds how far `..` may climb
	const absolute = joined.startsWith('/');
	const resolved: string[] = [];

	// 4. Walk the segments: `.` is a no-op, `..` pops the previous real segment, or stays when there is none to pop
	//    in a relative path, or vanishes in an absolute one, since there is nothing above the root
	for (const segment of joined.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}

		if (segment === '..') {
			if (resolved.length > 0 && resolved.at(-1) !== '..') {
				resolved.pop();
			} else if (!absolute) {
				resolved.push('..');
			}

			continue;
		}

		resolved.push(segment);
	}

	// 5. Put the root back; an absolute path that resolved to nothing is the root itself
	return (absolute ? '/' : '') + resolved.join('/');
};
