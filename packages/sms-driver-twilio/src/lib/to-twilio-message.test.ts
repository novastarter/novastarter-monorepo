/**
 * Tests of `to-twilio-message`: how a message and the location's defaults become the payload of Twilio's
 * `messages.create()`.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { toTwilioMessage } from './to-twilio-message.js';

describe('toTwilioMessage', () => {
	test('Carries the recipient, the text and the sender over', () => {
		expect(toTwilioMessage({ to: '+14155550123', from: 'Acme', text: 'Hi' })).toStrictEqual({
			to: '+14155550123',
			body: 'Hi',
			from: 'Acme',
		});
	});

	test('Lets the message sender win over the location messaging service', () => {
		// One location serves both: a campaign sending from the pool and a message that names its own number.
		expect(
			toTwilioMessage({ to: '+14155550123', from: '+14155550100', text: 'Hi' }, { messagingServiceSid: 'MG1' }),
		).toStrictEqual({ to: '+14155550123', body: 'Hi', from: '+14155550100' });

		expect(toTwilioMessage({ to: '+14155550123', text: 'Hi' }, { messagingServiceSid: 'MG1' })).toStrictEqual({
			to: '+14155550123',
			body: 'Hi',
			messagingServiceSid: 'MG1',
		});
	});

	test('Sets the optional fields only when they are given', () => {
		expect(
			toTwilioMessage({ to: '+14155550123', from: 'Acme', text: 'Hi', ttl: 3_600 }, { statusCallback: 'https://x' }),
		).toStrictEqual({
			to: '+14155550123',
			body: 'Hi',
			from: 'Acme',
			validityPeriod: 3_600,
			statusCallback: 'https://x',
		});
	});

	test('Refuses a message no sender can be found for', () => {
		// Twilio answers 21603 for a request without a sender, so the error names the options to configure instead.
		expect(() => toTwilioMessage({ to: '+14155550123', text: 'Hi' })).toThrow(InvalidConfigError);
		expect(() => toTwilioMessage({ to: '+14155550123', text: 'Hi' })).toThrow(/"from" on the message/);
		expect(() => toTwilioMessage({ to: '+14155550123', text: 'Hi' })).toThrow(/"messagingServiceSid"/);
	});
});
