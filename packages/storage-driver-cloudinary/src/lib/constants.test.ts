/**
 * Tests of `storage-driver-cloudinary/lib/constants`.
 */
import { describe, expect, test } from 'vitest';
import { IMAGE_EXTENSIONS, MINIMUM_CHUNK_SIZE, VIDEO_EXTENSIONS } from './constants.js';

describe.each([
	['IMAGE_EXTENSIONS', IMAGE_EXTENSIONS],
	['VIDEO_EXTENSIONS', VIDEO_EXTENSIONS],
])('%s', (_name, extensions) => {
	test('Holds only lower-case, dot-prefixed extensions', () => {
		// 1. The driver compares a lower-cased `extname`, which keeps the dot, against these lists; an entry in another
		//    form would never match and its files would silently be uploaded as `raw`
		for (const extension of extensions) {
			expect(extension).toMatch(/^\.[a-z0-9]+$/);
		}
	});

	test('Holds every extension once', () => {
		// 1. A duplicate is harmless to the lookup but hides a copy-paste slip when the list is edited
		expect(new Set(extensions).size).toBe(extensions.length);
	});
});

test('IMAGE_EXTENSIONS and VIDEO_EXTENSIONS do not overlap', () => {
	// 1. The image list is checked first, so an extension on both lists would never reach the video endpoint
	const overlap = IMAGE_EXTENSIONS.filter((extension) => VIDEO_EXTENSIONS.includes(extension));

	expect(overlap).toStrictEqual([]);
});

test('MINIMUM_CHUNK_SIZE is 5 MiB', () => {
	// 1. Cloudinary rejects chunks below 5 MB; the constant gates the TUS chunk size at construction
	expect(MINIMUM_CHUNK_SIZE).toBe(5 * 1024 * 1024);
});
