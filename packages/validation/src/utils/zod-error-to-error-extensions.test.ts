/**
 * Tests of `validation/utils/zod-error-to-error-extensions`.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { zodErrorToErrorExtensions } from './zod-error-to-error-extensions.js';

/**
 * The issues a schema reports for a payload, run through the converter.
 *
 * @param schema - Schema to check against.
 * @param payload - Payload that has to fail.
 * @returns The extensions of every issue.
 * @throws Plain `Error` when the payload unexpectedly passes, so a test cannot silently assert on an empty issue
 * list.
 */
const convert = (schema: z.ZodType, payload: unknown) => {
	// Run the schema without throwing, so the issues are available as data
	const result = schema.safeParse(payload);

	// A passing payload would make the test assert on nothing, so fail loudly
	if (result.success) throw new Error('Expected the payload to fail');

	return zodErrorToErrorExtensions(result.error);
};

test('Names the field and the path below it', () => {
	const schema = z.object({ items: z.array(z.object({ count: z.number() })) });

	expect(convert(schema, { items: [{ count: 'x' }] })).toStrictEqual([
		{ field: 'items', path: [0, 'count'], type: 'required' },
	]);
});

test('Reports a missing value and a wrong type as required', () => {
	// Both are `invalid_type` issues to zod, and both read as "field not usable" to the client
	const schema = z.object({ to: z.string(), count: z.number() });

	expect(convert(schema, { count: 'x' })).toStrictEqual([
		{ field: 'to', path: [], type: 'required' },
		{ field: 'count', path: [], type: 'required' },
	]);
});

test('Maps bounds onto the comparison operators, inclusive or not', () => {
	// zod flags whether a bound is inclusive, which decides between gte / gt and lte / lt
	const schema = z.object({ a: z.number().min(1), b: z.number().gt(1), c: z.number().max(5), d: z.number().lt(5) });

	expect(convert(schema, { a: 0, b: 1, c: 6, d: 5 })).toStrictEqual([
		{ field: 'a', path: [], type: 'gte', valid: 1 },
		{ field: 'b', path: [], type: 'gt', valid: 1 },
		{ field: 'c', path: [], type: 'lte', valid: 5 },
		{ field: 'd', path: [], type: 'lt', valid: 5 },
	]);
});

test('Maps string formats onto their operators, and the rest onto regex', () => {
	// Formats with an operator of their own keep it with the compared text; a uuid has none and reports the
	// pattern zod checked
	const schema = z.object({
		email: z.email(),
		prefix: z.string().startsWith('a'),
		suffix: z.string().endsWith('z'),
		inner: z.string().includes('m'),
		pattern: z.string().regex(/^\d+$/),
		id: z.uuid(),
	});

	expect(convert(schema, { email: 'nope', prefix: 'b', suffix: 'y', inner: 'x', pattern: 'x', id: 'x' })).toStrictEqual(
		[
			{ field: 'email', path: [], type: 'email' },
			{ field: 'prefix', path: [], type: 'starts_with', substring: 'a' },
			{ field: 'suffix', path: [], type: 'ends_with', substring: 'z' },
			{ field: 'inner', path: [], type: 'contains', substring: 'm' },
			{ field: 'pattern', path: [], type: 'regex', invalid: '/^\\d+$/' },
			{ field: 'id', path: [], type: 'regex', invalid: expect.stringContaining('[0-9a-fA-F]') },
		],
	);
});

test('Maps an enum onto in and a literal onto eq', () => {
	// Both are `invalid_value` issues; the size of the allowed list tells them apart
	const schema = z.object({ route: z.enum(['transactional', 'marketing']), kind: z.literal('mail') });

	expect(convert(schema, { route: 'x', kind: 'y' })).toStrictEqual([
		{ field: 'route', path: [], type: 'in', valid: ['transactional', 'marketing'] },
		{ field: 'kind', path: [], type: 'eq', valid: 'mail' },
	]);
});

test('Falls back to unsafe for rules without an operator form, and to an empty field on the root', () => {
	// A refinement and an unknown key have no operator; the unknown key is reported on the root, which has no
	// field name
	const schema = z.object({ n: z.number().refine((n) => n % 2 === 0) }).strict();

	expect(convert(schema, { n: 1, extra: true })).toStrictEqual([
		{ field: 'n', path: [], type: 'unsafe' },
		{ field: '', path: [], type: 'unsafe' },
	]);
});
