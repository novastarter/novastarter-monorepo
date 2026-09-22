/**
 * Tests of `to-twilio-message`: how a message and the location's defaults become the payload of Twilio's
 * `messages.create()`.
 */
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
		// 1. One location serves both: a campaign sending from the pool and a message that names its own number
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
		// 1. `ttl` is Twilio's `validityPeriod`, in seconds; the callback is the location's
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
		// 1. Twilio answers 21603 for a request without a sender; the option names say what to configure instead
		expect(() => toTwilioMessage({ to: '+14155550123', text: 'Hi' })).toThrow(/"from" or a "messagingServiceSid"/);
	});
});
