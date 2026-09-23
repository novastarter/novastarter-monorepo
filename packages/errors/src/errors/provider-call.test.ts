/**
 * Tests of `errors/errors/provider-call`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { isNovastarterError } from '../is-novastarter-error.js';
import { HitRateLimitError } from './hit-rate-limit.js';
import { ProviderCallError, providerErrorReason, toProviderCallError } from './provider-call.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('providerErrorReason', () => {
	test('Reads the reason out of the shapes providers answer with', () => {
		// 1. One shape per provider family
		expect(providerErrorReason({ error: { message: 'No such customer', type: 'invalid_request_error' } })).toBe(
			'No such customer',
		);

		expect(
			providerErrorReason({ error: { type: 'request_error', code: 'not_found', detail: 'Entity not found' } }),
		).toBe('Entity not found');

		expect(providerErrorReason({ error: 'invalid_grant', error_description: 'Bad code' })).toBe('Bad code');
		expect(providerErrorReason({ message: 'Not found' })).toBe('Not found');
		expect(providerErrorReason({ errors: [{ detail: 'Price is required', status: '422' }] })).toBe('Price is required');
		expect(providerErrorReason({ ErrorCode: 300, Message: 'Invalid email' })).toBe('Invalid email');
		expect(providerErrorReason({ ErrorMessage: 'Unknown resource' })).toBe('Unknown resource');
		expect(providerErrorReason({ error: 'forbidden' })).toBe('forbidden');
		expect(providerErrorReason({ errors: ['Sender domain is not verified'] })).toBe('Sender domain is not verified');
		expect(providerErrorReason({ errors: 'Unauthorized' })).toBe('Unauthorized');
	});

	test('Folds and cuts a text answer, and names nothing for an answer without a reason', () => {
		// 1. An HTML page is one line, cut with an ellipsis
		expect(providerErrorReason('  <html>\n  Bad   Gateway </html> ')).toBe('<html> Bad Gateway </html>');
		expect(providerErrorReason('x'.repeat(400))).toBe(`${'x'.repeat(300)}…`);

		// 2. Nothing to quote
		expect(providerErrorReason({ ok: false })).toBeUndefined();
		expect(providerErrorReason(undefined)).toBeUndefined();
		expect(providerErrorReason('   ')).toBeUndefined();
	});
});

describe('ProviderCallError', () => {
	test('Carries the code, 502, the provider’s status and answer, and a message without credentials', () => {
		const error = new ProviderCallError({
			provider: 'stripe',
			method: 'POST /v1/refunds',
			status: 404,
			body: { error: { message: 'No such payment_intent' } },
		});

		// 1. The provider refused, not the application's caller
		expect(error.code).toBe('PROVIDER_CALL_FAILED');
		expect(error.status).toBe(502);
		expect(error.message).toBe('stripe refused POST /v1/refunds: 404 No such payment_intent');
		expect(error.extensions.status).toBe(404);
		expect(isNovastarterError(error, 'PROVIDER_CALL_FAILED')).toBe(true);
	});
});

describe('toProviderCallError', () => {
	test('Makes a 429 a HitRateLimitError reset at Retry-After, in seconds or as a date', () => {
		// 1. Seconds from a `Headers` object
		const seconds = toProviderCallError({
			provider: 'polar',
			method: 'GET /v1/products',
			status: 429,
			body: undefined,
			headers: new Headers({ 'Retry-After': '7' }),
		});

		expect(seconds).toBeInstanceOf(HitRateLimitError);
		expect((seconds as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 7_000);

		// 2. A date from a plain record; the body's own wait wins when given
		const dated = toProviderCallError({
			provider: 'resend',
			method: 'GET /domains',
			status: 429,
			body: undefined,
			headers: { 'retry-after': new Date(NOW + 3_000).toUTCString() },
		});

		expect((dated as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 3_000);

		const named = toProviderCallError({ provider: 'x', method: 'GET /', status: 429, body: {}, retryAfter: 2 });

		expect((named as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 2_000);

		// 3. An absurd wait is a day, a negative one now, a blank header or a broken number none — one second
		const huge = toProviderCallError({
			provider: 'x',
			method: 'GET /',
			status: 429,
			body: {},
			headers: { 'retry-after': '99999999999999999' },
		});

		expect((huge as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 86_400_000);

		const negative = toProviderCallError({ provider: 'x', method: 'GET /', status: 429, body: {}, retryAfter: -5 });

		expect((negative as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW);

		for (const blank of [{ headers: { 'retry-after': '' } }, { retryAfter: Number.NaN }]) {
			const error = toProviderCallError({ provider: 'x', method: 'GET /', status: 429, body: {}, ...blank });

			expect((error as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 1_000);
		}

		// 4. No wait named: one second
		const bare = toProviderCallError({ provider: 'x', method: 'GET /', status: 429, body: {} });

		expect((bare as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(NOW + 1_000);
	});

	test('Makes anything else a ProviderCallError, with the SDK’s error as cause', () => {
		const cause = new Error('StripeInvalidRequestError');
		const error = toProviderCallError({ provider: 'stripe', method: 'GET /v1/x', status: 400, body: {}, cause });

		// 1. The status and the cause are kept
		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('stripe refused GET /v1/x: 400');
		expect(error.cause).toBe(cause);
	});
});
