/**
 * Tests of `auth/providers/lib/events`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthIdentity } from '../types.js';
import {
	AUTH_SIGN_IN_FAILED_EVENT,
	AUTH_SIGN_IN_FILTER,
	AUTH_SIGNED_IN_EVENT,
	completeSignIn,
	failSignIn,
} from './events.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

/**
 * Logger double; nothing here should write to it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the identity back unchanged unless a test says otherwise, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * The identity every test signs in with.
 */
const identity: AuthIdentity = { provider: 'github', subject: '42' };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('event names', () => {
	test('Are the documented ones', () => {
		// 1. Applications subscribe by these strings, so they are part of the API
		expect(AUTH_SIGN_IN_FILTER).toBe('auth.sign-in');
		expect(AUTH_SIGNED_IN_EVENT).toBe('auth.signed-in');
		expect(AUTH_SIGN_IN_FAILED_EVENT).toBe('auth.sign-in-failed');
	});
});

describe('completeSignIn', () => {
	test('Runs the filter and announces the identity it returned', async () => {
		// 1. The filter's result is what the caller and the listeners get
		emitter.emitFilter.mockResolvedValueOnce({ ...identity, name: 'Filtered' });

		const result = await completeSignIn('github', identity);

		expect(result).toStrictEqual({ ...identity, name: 'Filtered' });
		expect(emitter.emitFilter).toHaveBeenCalledWith(AUTH_SIGN_IN_FILTER, identity, { location: 'github' });
		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, { location: 'github', payload: result });
	});

	test('Throws wrong credentials on a veto and announces the failure', async () => {
		// 1. `null` refuses, and the reason says a filter did it
		emitter.emitFilter.mockResolvedValueOnce(null);

		await expect(completeSignIn('github', identity)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'github',
			provider: 'github',
			reason: 'filter',
		});

		expect(emitter.emitAction).toHaveBeenCalledTimes(1);
	});
});

describe('failSignIn', () => {
	test('Announces the error code as the reason and hands the error back', () => {
		const error = Object.assign(new Error('nope'), { code: 'SOME_CODE' });

		// 1. The same error comes back for rethrowing
		expect(failSignIn('github', error)).toBe(error);

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'github',
			reason: 'SOME_CODE',
		});
	});

	test('Falls back to a generic reason for errors without a code, null included', () => {
		// 1. A plain error and a thrown `null` both count as `error`
		failSignIn('github', new Error('plain'));
		failSignIn('github', null);

		expect(emitter.emitAction).toHaveBeenNthCalledWith(1, AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'github',
			reason: 'error',
		});

		expect(emitter.emitAction).toHaveBeenNthCalledWith(2, AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'github',
			reason: 'error',
		});
	});
});
