/**
 * Tests of `storage/lib/keys`: the list prefix a driver queries with and the relative path it yields.
 */
import { confinePath, joinPath } from '@novastarter/utils';
import { expect, test } from 'vitest';
import { toListPrefix, toRelativePath } from './keys.js';

test('toListPrefix asks for a folder with a trailing slash and leaves a partial key alone', () => {
	// 1. The whole root is `root/`, so `media-archive/…` is not matched by `media`
	expect(toListPrefix('media', '')).toBe('media/');
	expect(toListPrefix('media/avatars', 'avatars/')).toBe('media/avatars/');

	// 2. A partial key stays a partial key; the whole bucket is the empty string
	expect(toListPrefix('media/av', 'av')).toBe('media/av');
	expect(toListPrefix('av', 'av')).toBe('av');
	expect(toListPrefix('', '')).toBe('');
	expect(toListPrefix('avatars', 'avatars/')).toBe('avatars/');
});

test('toListPrefix treats a prefix that resolves to a folder as that folder, not as a partial key', () => {
	// 1. `.`, `..` and `avatars/..` resolve to the root, so they list `media/` and cannot reach `media-archive/…`
	expect(toListPrefix('media', '.')).toBe('media/');
	expect(toListPrefix('media', '..')).toBe('media/');
	expect(toListPrefix('media', 'avatars/..')).toBe('media/');
	expect(toListPrefix('media', '/')).toBe('media/');

	// 2. A `.` segment at the end names the folder before it; a backslash is a separator like a slash
	expect(toListPrefix('media/avatars', 'avatars/.')).toBe('media/avatars/');
	expect(toListPrefix('media/avatars', 'avatars\\')).toBe('media/avatars/');

	// 3. A `..` in the middle only changes which key is partial; a segment of three dots is a name, not a folder
	expect(toListPrefix('media/a/c', 'a/b/../c')).toBe('media/a/c');
	expect(toListPrefix('media/a/...', 'a/...')).toBe('media/a/...');

	// 4. The empty root stays the whole bucket for a prefix that resolves to nothing
	expect(toListPrefix('', '.')).toBe('');
});

test('toListPrefix built the way a driver builds it never lists a key outside the location', () => {
	// 1. Drivers pass `joinPath(root, confinePath(prefix))` and the raw prefix; every prefix that resolves to the root
	//    must query `media/`, since `toRelativePath` cannot strip `media-archive/…` from what `media` would list
	for (const prefix of ['', '.', '..', 'avatars/..', '../..', './']) {
		expect(toListPrefix(joinPath('media', confinePath(prefix)), prefix)).toBe('media/');
	}
});

test('toRelativePath strips the root and its slash, and nothing else', () => {
	// 1. The root and the slash after it go; with no root there is nothing to strip
	expect(toRelativePath('media', 'media/avatars/me.png')).toBe('avatars/me.png');
	expect(toRelativePath('', 'avatars/me.png')).toBe('avatars/me.png');

	// 2. Only `root/` is stripped, not a shared string prefix: a key under `media-archive/` keeps its own root
	expect(toRelativePath('media', 'media-archive/c.png')).toBe('media-archive/c.png');
});
