/**
 * Tests of `storage-driver-supabase/lib/dirname`.
 */
import { expect, test } from 'vitest';
import { dirname } from './dirname.js';

test('Returns everything before the last slash of a nested path', () => {
	expect(dirname('media/avatars/me.png')).toBe('media/avatars');
});

test('Returns an empty string for a bare name, where node:path would answer "."', () => {
	expect(dirname('me.png')).toBe('');
});

test('Returns the folder itself for a prefix ending in a slash', () => {
	expect(dirname('media/avatars/')).toBe('media/avatars');
});

test('Splits on forward slashes only, since Supabase object names are not platform paths', () => {
	expect(dirname('media\\avatars\\me.png')).toBe('');
});
