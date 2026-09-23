/**
 * Tests of `notifications/lib/channels/sms`; `@novastarter/sms` is mocked.
 */
import { sendSms } from '@novastarter/sms';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { smsChannel } from './sms.js';

vi.mock('@novastarter/sms');

afterEach(() => {
	vi.clearAllMocks();
});

describe('smsChannel', () => {
	test('Reaches a user with a number only', () => {
		// 1. No number, nothing to send to
		expect(smsChannel().reaches({ userId: 'u1', phone: '+15555550100' })).toBe(true);
		expect(smsChannel().reaches({ userId: 'u1' })).toBe(false);
	});

	test('Sends the text to the user’s number, through the location when one is given', async () => {
		// 1. The recipient is the channel's; the location is passed on
		await smsChannel({ location: 'twilio' }).send({
			notification: { type: 'invoice.paid', userId: 'u1' },
			recipient: { userId: 'u1', phone: '+15555550100' },
			content: { text: 'Invoice 1042 is paid' },
		});

		expect(sendSms).toHaveBeenCalledWith({ text: 'Invoice 1042 is paid', to: '+15555550100' }, { location: 'twilio' });
	});
});
