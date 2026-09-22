/**
 * Tests of `storage/lib/keys`: the list prefix a driver queries with and the relative path it yields.
 */
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

test('toRelativePath strips the root and its slash, and nothing else', () => {
	expect(toRelativePath('media', 'media/avatars/me.png')).toBe('avatars/me.png');
	expect(toRelativePath('', 'avatars/me.png')).toBe('avatars/me.png');
	expect(toRelativePath('media', 'media-archive/c.png')).toBe('media-archive/c.png');
});
