/**
 * Tests of `storage-driver-cloudinary/lib/to-form-url-encoded`.
 */
import { expect, test } from 'vitest';
import { toFormUrlEncoded } from './to-form-url-encoded.js';

test('Returns an empty string for an empty object', () => {
	// 1. No entries means no body at all; a stray separator would be read by the server as an empty parameter
	expect(toFormUrlEncoded({})).toBe('');
});

test('Serializes entries as key=value pairs joined by ampersands, in insertion order', () => {
	// 1. A request body keeps insertion order by default, so callers control which parameter Cloudinary sees first
	expect(
		toFormUrlEncoded({
			second: 'two',
			first: 'one',
			third: 'three',
		}),
	).toBe('second=two&first=one&third=three');
});

test('Sorts entries alphabetically by key when the sort option is enabled', () => {
	// 1. Sorting produces a canonical form, so two payloads with the same entries serialize to the same string
	expect(
		toFormUrlEncoded(
			{
				b_key: 'second',
				c_key: 'third',
				a_key: 'first',
			},
			{ sort: true },
		),
	).toBe('a_key=first&b_key=second&c_key=third');
});

test('Keeps slashes in values unescaped so folder paths survive', () => {
	// 1. Folder paths are part of a public id; leaving the slash verbatim keeps the body readable in request logs
	expect(toFormUrlEncoded({ public_id: 'folder/sub/file' })).toBe('public_id=folder/sub/file');
});

test('Percent-encodes a plus sign so it is not read as a space', () => {
	// 1. A form body decodes `+` as a space, so a public id such as `c++.zip` must go out as `%2B`; decoding the whole
	//    body used to turn it back into a literal `+` and the server looked up `c  .zip`
	expect(toFormUrlEncoded({ public_id: 'c++.zip' })).toBe('public_id=c%2B%2B.zip');
});

test('Percent-encodes ampersand, equals and percent so a value cannot split the parameter list', () => {
	// 1. An unescaped `&` or `=` in a value starts a new parameter on the server, and a bare `%` is a broken escape
	expect(toFormUrlEncoded({ public_id: 'a&b=c%d.zip' })).toBe('public_id=a%26b%3Dc%25d.zip');
});

test('Round-trips every value through a form-body parser unchanged', () => {
	// 1. What matters is what the server reconstructs: parsing the body back must yield the raw values, since the
	//    signature is computed over those and a mismatch fails every lookup, delete and rename
	const payload = {
		public_id: 'my folder/c++ & more=100%.zip',
		asset_folder: 'my folder',
	};

	const parsed = Object.fromEntries(new URLSearchParams(toFormUrlEncoded(payload)));

	expect(parsed).toStrictEqual(payload);
});
