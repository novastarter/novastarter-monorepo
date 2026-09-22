/**
 * Tests of `memory/utils/serialize`.
 */
import { expect, test } from 'vitest';
import { deserialize, serialize } from './serialize.js';

/**
 * One value of every kind the store accepts, so the JSON round trip is checked for each shape it has to preserve.
 */
const cases: [string, unknown][] = [
	['object', { hello: 'world' }],
	['string', 'Hello World'],
	['number', 42],
	['boolean', true],
	['array', [{ hello: 'goodbye' }, { hello: 'world' }]],
];

test.each(cases)('%s', (_description, input) => {
	// 1. Serializing answers with bytes, the form both backends store
	const serialized = serialize(input);

	expect(serialized).toBeInstanceOf(Uint8Array);

	// 2. Deserializing gives an equal value back — equal, not the same reference, which is the point of storing bytes
	const deserialized = deserialize(serialized);

	expect(deserialized).toEqual(input);
});

test('deserialize handles empty buffer', () => {
	// 1. Redis can hand back an empty reply during a disconnect; it reads as "no value" rather than as a parse error
	const result = deserialize(new Uint8Array());
	expect(result).toBeUndefined();
});
