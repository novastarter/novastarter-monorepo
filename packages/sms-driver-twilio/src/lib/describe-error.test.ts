/**
 * Tests of `describe-error`: how what the Twilio SDK throws becomes the error `sendSms()` reports.
 */
import twilio from 'twilio';
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

/**
 * A `RestException` as the SDK builds it: from the answered response.
 *
 * @param body - The JSON body Twilio answered with.
 * @param statusCode - The HTTP status.
 * @returns The SDK's error.
 */
const restException = (body: Record<string, unknown>, statusCode = 400): twilio.RestException =>
	new twilio.RestException({ statusCode, body });

describe('describeError', () => {
	test('Names the status, the error code and the help URL of a refused request', () => {
		// 1. The code is what an application matches on (21211 is an unusable number), the URL what a developer opens
		const refusal = restException({
			message: 'The "To" number is not a valid phone number.',
			code: 21211,
			more_info: 'https://www.twilio.com/docs/errors/21211',
		});

		expect(describeError(refusal)).toMatchObject({
			message:
				'Twilio: 400 21211: The "To" number is not a valid phone number. (https://www.twilio.com/docs/errors/21211)',
			cause: refusal,
		});
	});

	test('Names the status alone when Twilio sent no code or help URL', () => {
		// 1. A body without a code still has a status worth reporting; `unknown` stands in for the missing code
		const refusal = restException({ message: 'Service unavailable' }, 503);

		expect(describeError(refusal).message).toBe('Twilio: 503 unknown: Service unavailable');
	});

	test('Prefixes anything that is not an answered request and passes it on as the cause', () => {
		// 1. A network failure never reached the API, so there is no status to report: only the message
		const socket = new Error('ETIMEDOUT');

		expect(describeError(socket)).toMatchObject({ message: 'Twilio: ETIMEDOUT', cause: socket });

		// 2. A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'Twilio: boom', cause: 'boom' });
	});
});
