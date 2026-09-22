/**
 * Tests of `describe-error`: how what the Vonage SDK throws becomes the error `sendSms()` reports.
 */
import { MessageSendAllFailure, MessageSendPartialFailure } from '@vonage/sms';
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the status and the wording of the first failed part', () => {
		// 1. Status 4 is a credential Vonage did not accept; the wording is its own
		const refusal = new MessageSendAllFailure({
			messageCount: 1,
			messages: [{ status: '4', errorText: 'Bad Credentials' }],
		} as never);

		expect(describeError(refusal)).toMatchObject({ message: 'Vonage: 4: Bad Credentials', cause: refusal });
	});

	test('Skips the parts that went out and keeps the whole answer on the cause', () => {
		// 1. A long message may be refused in part only; the failed part is what the caller acts on, the rest stays
		//    reachable through the cause
		const partial = new MessageSendPartialFailure({
			messageCount: 2,
			messages: [
				{ status: '0', messageId: 'm-1' },
				{ status: '9', errorText: 'Partner quota violation' },
			],
		} as never);

		expect(describeError(partial).message).toBe('Vonage: 9: Partner quota violation');
		expect((describeError(partial).cause as MessageSendPartialFailure).getSuccessfulMessages()).toHaveLength(1);
	});

	test('Falls back to the SDK message when the answer names no failed part', () => {
		// 1. An empty answer leaves nothing to quote; the SDK's own sentence is still better than nothing
		const empty = new MessageSendAllFailure({ messageCount: 0, messages: [] } as never);

		expect(describeError(empty).message).toBe('Vonage: unknown: All SMS messages failed to send');
	});

	test('Prefixes anything that is not a refusal and passes it on as the cause', () => {
		// 1. A network failure never reached the API, so there is no status to report: only the message
		const socket = new Error('ENOTFOUND');

		expect(describeError(socket)).toMatchObject({ message: 'Vonage: ENOTFOUND', cause: socket });

		// 2. A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'Vonage: boom', cause: 'boom' });
	});
});
