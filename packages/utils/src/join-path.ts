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
 * @param segments - Key or URL path parts, strings only.
 * @returns The joined, normalised path.
 * @throws TypeError when a segment is not a string: `undefined` or `null` would silently vanish and a number would be
 * spelled out, and a storage key built from a missing path must fail before a request goes out on the root instead.
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
	// Only strings join: `Array.prototype.join` would turn `undefined` and `null` into nothing and spell a number
	// out, so a caller path missing at runtime — past the types — would quietly name the root
	for (const segment of segments) {
		if (typeof segment !== 'string') {
			throw new TypeError(`joinPath: every segment must be a string, got ${typeof segment}`);
		}
	}

	// Skip empty parts, so `joinPath('', 'a')` and `joinPath('a')` are the same path; nothing left means no path
	const parts = segments.filter((segment) => segment !== '');

	if (parts.length === 0) {
		return '';
	}

	// Remember whether the path is rooted before anything is collapsed: the root must survive resolution and
	// bounds how far `..` may climb, and a path made only of separators (`joinPath('/', '/')`) normalises to
	// nothing, so the raw join is the one place the root can still be seen
	const raw = parts.join('/');
	const absolute = raw.startsWith('/') || raw.startsWith('\\');

	// Collapse separators and backslashes, so the split below only ever sees single forward slashes
	const joined = normalizePath(raw);
	const resolved: string[] = [];

	// Walk the segments: `.` is a no-op, `..` pops the previous real segment, or stays when there is none to pop
	// in a relative path, or vanishes in an absolute one, since there is nothing above the root
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

	// An absolute path that resolved to nothing is the root itself.
	return (absolute ? '/' : '') + resolved.join('/');
};

/**
 * Resolve `.` and `..` in a caller path as if it were rooted, and answer with the relative result.
 *
 * What a storage driver runs a caller's path through before joining it under the location root: resolved against
 * `/` first, a leading `..` has nothing to climb and is dropped, so `../other/secret` becomes `other/secret` and can
 * never address anything above the root it is then joined to. A leading slash is dropped as well, so the result joins
 * cleanly under an empty root too. An empty path stays empty.
 *
 * @param filepath - Path as the caller gave it, relative or not; a string.
 * @returns The path confined to a root, relative, without a leading slash; `''` for an empty or `.`-only path.
 * @throws TypeError when `filepath` is not a string, as {@link joinPath} does.
 * @example
 * ```ts
 * confinePath('../other/secret.txt');
 * // => 'other/secret.txt'
 *
 * joinPath('media', confinePath('/avatars/../me.png'));
 * // => 'media/me.png'
 * ```
 */
export const confinePath = (filepath: string): string => {
	// Rooted, `..` cannot climb; the root itself is then dropped, since the caller's root is the one that matters
	return joinPath('/', filepath).slice(1);
};
