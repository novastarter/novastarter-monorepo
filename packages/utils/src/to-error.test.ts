/**
 * Tests of `utils/toError`: an `Error` passes through, anything else is wrapped with the original as `cause`.
 */
import { expect, test } from 'vitest';
import { toError } from './to-error.js';

test('Passes an Error through as the same instance', () => {
	// 1. Identity and class survive, so `instanceof` checks and own fields downstream keep working
	const error = new RangeError('boom');

	expect(toError(error)).toBe(error);
	expect(toError(error)).toBeInstanceOf(RangeError);
});

test('Wraps a non-Error value, keeping it as cause', () => {
	// 1. The message is what `toErrorMessage` makes of the value; the value itself is reachable as `cause`
	const wrapped = toError('boom');

	expect(wrapped).toBeInstanceOf(Error);
	expect(wrapped.message).toBe('boom');
	expect(wrapped.cause).toBe('boom');
});

test('Wraps objects and absent values', () => {
	// 1. A vendor payload thrown as a plain object stays inspectable through `cause`
	const payload = { code: 'E_AUTH' };

	expect(toError(payload).cause).toBe(payload);
	expect(toError(payload).message).toBe('[object Object]');
	expect(toError(undefined).message).toBe('undefined');
	expect(toError(undefined).cause).toBeUndefined();
	expect(toError(null).message).toBe('null');
	expect(toError(null).cause).toBeNull();
});

test('Wraps an object without a prototype instead of throwing', () => {
	// 1. `String()` on such an object throws; the wrapper still gets a message and the value as cause
	const bare = Object.create(null);

	expect(toError(bare).message).toBe('[object Object]');
	expect(toError(bare).cause).toBe(bare);
});

test('Never throws, even for a revoked Proxy, and wraps it', () => {
	// 1. `instanceof` on a revoked Proxy throws; the helper wraps the value instead, so a `catch` clause can rely on it
	const revocable = Proxy.revocable({}, {});
	revocable.revoke();

	const error = toError(revocable.proxy);

	expect(error).toBeInstanceOf(Error);
	expect(error.message).toBe('[unreadable value]');
	expect(error.cause).toBe(revocable.proxy);
});
