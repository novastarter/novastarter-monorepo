/**
 * Tests of `storage-driver-cloudinary/lib/to-signature-string`.
 */
import { expect, test } from 'vitest';
import { toSignatureString } from './to-signature-string.js';

test('Returns an empty string for an empty object', () => {
	// 1. With nothing to sign only the API secret goes into the digest; a stray separator would change the hash
	expect(toSignatureString({})).toBe('');
});

test('Sorts entries alphabetically by key', () => {
	// 1. Cloudinary rebuilds the signed string in alphabetical key order, so insertion order must not leak into it
	expect(
		toSignatureString({
			b_key: 'second',
			c_key: 'third',
			a_key: 'first',
		}),
	).toBe('a_key=first&b_key=second&c_key=third');
});

test('Preserves spaces in values instead of encoding them as plus signs', () => {
	// 1. Cloudinary signs the raw values it receives, so a space encoded as `+` would produce a digest it never matches
	expect(toSignatureString({ asset_folder: 'my folder' })).toBe('asset_folder=my folder');
});

test('Emits values verbatim without any URL-encoding', () => {
	// 1. Every reserved character stays as it is for the same reason: the digest is computed over the raw values
	expect(toSignatureString({ path: 'a b/c+d' })).toBe('path=a b/c+d');
});
