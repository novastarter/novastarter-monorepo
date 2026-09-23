/**
 * Tests of `utils/call`: the parser of a driver's `call()` method.
 */
import { describe, expect, test } from 'vitest';
import { parseCallMethod } from './call.js';

describe('parseCallMethod', () => {
	test('Splits a verb and a path or URL, the verb upper-cased', () => {
		// 1. Any case and spacing of the verb
		expect(parseCallMethod('post /v1/refunds')).toStrictEqual({ verb: 'POST', target: '/v1/refunds' });

		expect(parseCallMethod('  GET   https://files.stripe.com/v1/files ')).toStrictEqual({
			verb: 'GET',
			target: 'https://files.stripe.com/v1/files',
		});
	});

	test('Refuses an unknown verb, a missing target, a relative or protocol-relative one', () => {
		// 1. Each is ambiguous or a typo
		expect(() => parseCallMethod('FETCH /x')).toThrow('The call method "FETCH /x" is not');
		expect(() => parseCallMethod('GET')).toThrow('is not');
		expect(() => parseCallMethod('GET customers')).toThrow('neither a path');
		expect(() => parseCallMethod('GET //evil.example/x')).toThrow('neither a path');
	});
});
