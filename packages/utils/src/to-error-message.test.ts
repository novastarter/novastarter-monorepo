/**
 * Tests of `utils/toErrorMessage`: the message of an `Error`, the text of anything else.
 */
import { expect, test } from 'vitest';
import { toErrorMessage } from './to-error-message.js';

test('Answers with the message of an Error', () => {
	// Subclasses count as errors too; only the message is taken, never the class name or the stack
	expect(toErrorMessage(new Error('boom'))).toBe('boom');
	expect(toErrorMessage(new TypeError('wrong type'))).toBe('wrong type');
});

test('Falls back to the name of an Error without a message', () => {
	// An empty message would leave a wrapped message or a log line ending in nothing; the class name says at
	// least what kind of error it was
	expect(toErrorMessage(new Error(''))).toBe('Error');
	expect(toErrorMessage(new RangeError())).toBe('RangeError');
});

test('Writes non-Error values as text', () => {
	// What vendor SDKs throw instead of errors: strings, numbers, plain objects
	expect(toErrorMessage('boom')).toBe('boom');
	expect(toErrorMessage(404)).toBe('404');
	expect(toErrorMessage({ code: 'E' })).toBe('[object Object]');
	expect(toErrorMessage({ toString: () => 'custom' })).toBe('custom');
});

test('Falls back to the object tag for a value String() cannot convert', () => {
	// An object without a prototype has no `toString`, so `String()` throws; describing an error must not
	expect(toErrorMessage(Object.create(null))).toBe('[object Object]');
});

test('Names an absent value instead of answering with nothing', () => {
	// `undefined` and `null` in a log line say more than an empty message
	expect(toErrorMessage(undefined)).toBe('undefined');
	expect(toErrorMessage(null)).toBe('null');
});

test('Never throws, even for a revoked or hostile Proxy', () => {
	// A revoked Proxy throws on any operation, `instanceof` included; a Proxy with a throwing `get` trap defeats
	// both `String()` and the `Symbol.toStringTag` lookup of the fallback
	const revocable = Proxy.revocable({}, {});
	revocable.revoke();

	const hostile = new Proxy(
		{},
		{
			get() {
				throw new Error('no');
			},
			getPrototypeOf() {
				throw new Error('no');
			},
		},
	);

	expect(toErrorMessage(revocable.proxy)).toBe('[unreadable value]');
	expect(typeof toErrorMessage(hostile)).toBe('string');
});
