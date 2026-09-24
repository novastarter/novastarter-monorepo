/**
 * Tests of `describe-error`: how what the Vonage SDK throws becomes the error `sendSms()` reports.
 */
import { inspect } from 'node:util';
import { MessageSendAllFailure, MessageSendPartialFailure } from '@vonage/sms';
import { describe, expect, test } from 'vitest';
import { SmsPartialDeliveryError } from '../index.js';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the status and the wording of the first failed part', () => {
		// Status 4 is a credential Vonage did not accept.
		const refusal = new MessageSendAllFailure({
			messageCount: 1,
			messages: [{ status: '4', errorText: 'Bad Credentials' }],
		} as never);

		expect(describeError(refusal)).toMatchObject({ message: 'Vonage: 4: Bad Credentials', cause: refusal });
	});

	test('Reports a message refused whole as a refusal even when the SDK calls it partial', () => {
		// Vonage sends `message-count` as a string, so the SDK's strict count check fails and it throws
		// MessageSendPartialFailure for a message no part of which went out; that is a refusal the chain may fall back
		// on.
		const refusal = new MessageSendPartialFailure({
			messageCount: '1',
			messages: [{ status: '4', errorText: 'Bad Credentials' }],
		} as never);

		const described = describeError(refusal);

		expect(described).not.toBeInstanceOf(SmsPartialDeliveryError);
		expect(described).toMatchObject({ message: 'Vonage: 4: Bad Credentials', cause: refusal });
	});

	test('Turns a partial failure into the non-retryable SmsPartialDeliveryError', () => {
		// The delivered parts already went out, so the failure is not a refusal a fallback would re-send.
		const partial = new MessageSendPartialFailure({
			messageCount: 2,
			messages: [
				{ status: '0', messageId: 'm-1' },
				{ status: '9', errorText: 'Partner quota violation' },
			],
		} as never);

		const described = describeError(partial);

		expect(described).toBeInstanceOf(SmsPartialDeliveryError);

		expect(described).toMatchObject({
			extensions: { delivered: 1, parts: 2, reason: '9: Partner quota violation' },
			cause: partial,
		});
	});

	test('Falls back to the SDK message when the answer names no failed part', () => {
		// An empty answer leaves nothing to quote; the SDK's own sentence is still better than nothing.
		const empty = new MessageSendAllFailure({ messageCount: 0, messages: [] } as never);

		expect(describeError(empty).message).toBe('Vonage: unknown: All SMS messages failed to send');
	});

	test('Prefixes anything that is not a refusal and passes it on as the cause', () => {
		// A network failure never reached the API, so there is no status to report.
		const socket = new Error('ENOTFOUND');

		expect(describeError(socket)).toMatchObject({ message: 'Vonage: ENOTFOUND', cause: socket });

		expect(describeError('boom')).toMatchObject({ message: 'Vonage: boom', cause: 'boom' });
	});

	test('Drops the SDK error of an error status, so the key pair in its request never becomes the cause', () => {
		// The SDK's VetchError keeps the prepared request, Basic Authorization header included, in `config`.
		const failure = Object.assign(new Error('Request failed with status code 500'), {
			config: { headers: { Authorization: 'Basic a2V5OnNlY3JldA==' } },
			response: { status: 500, statusText: 'Internal Server Error' },
		});

		const described = describeError(failure);

		// Nothing is attached that could be printed with the error.
		expect(described.message).toBe('Vonage: 500: Internal Server Error');
		expect(described.cause).toBeUndefined();
		expect(inspect(described)).not.toContain('Basic');
	});
});
