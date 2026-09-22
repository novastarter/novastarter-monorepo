/**
 * Tests of `errors/codes`.
 */
import { expect, test } from 'vitest';
import { ErrorCode } from './codes.js';

test('Values are the upper-cased names of their errors', () => {
	// 1. The code is what clients match on and what `createError` stores on the error; a drift between member and
	//    value would silently change the API
	expect(ErrorCode.InvalidCredentials).toBe('INVALID_CREDENTIALS');
	expect(ErrorCode.InvalidPayload).toBe('INVALID_PAYLOAD');
	expect(ErrorCode.RequestsExceeded).toBe('REQUESTS_EXCEEDED');
});
