/**
 * Tests of `notifications/lib/channels/mail`; `@novastarter/mail` is mocked.
 */
import { sendMail } from '@novastarter/mail';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mailChannel } from './mail.js';

vi.mock('@novastarter/mail');

/**
 * The notification every delivery carries.
 */
const NOTIFICATION = { type: 'invoice.paid', userId: 'u1' };

afterEach(() => {
	vi.clearAllMocks();
});

describe('mailChannel', () => {
	test('Reaches a user with an address only', () => {
		expect(mailChannel().reaches({ userId: 'u1', email: 'a@example.com' })).toBe(true);
		expect(mailChannel().reaches({ userId: 'u1', email: null })).toBe(false);
	});

	test('Sends the content to the user’s address, through the location when one is given', async () => {
		const delivery = {
			notification: NOTIFICATION,
			recipient: { userId: 'u1', email: 'a@example.com' },
			content: { subject: 'Paid', text: 'Invoice 1042 is paid', to: 'someone@else.com' } as never,
		};

		await mailChannel().send(delivery);

		expect(sendMail).toHaveBeenCalledWith({ subject: 'Paid', text: 'Invoice 1042 is paid', to: 'a@example.com' }, {});

		await mailChannel({ location: 'marketing' }).send(delivery);

		expect(sendMail).toHaveBeenLastCalledWith(expect.anything(), { location: 'marketing' });
	});
});
