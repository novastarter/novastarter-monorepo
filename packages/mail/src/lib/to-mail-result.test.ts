/**
 * Tests of `mail/lib/to-mail-result`: nodemailer's transport results, in every shape, as one `MailResult`.
 */
import { describe, expect, test } from 'vitest';
import { toMailResult } from './to-mail-result.js';

describe('toMailResult', () => {
	test('Flattens the accepted and rejected lists, strings and address objects alike', () => {
		// The SMTP transport mixes both shapes; the result reports addresses only
		expect(
			toMailResult({
				messageId: '<id@acme>',
				accepted: ['ada@example.com', { address: 'grace@example.com' }],
				rejected: [{ address: 'bob@example.com' }],
				response: '250 OK',
			}),
		).toStrictEqual({
			messageId: '<id@acme>',
			accepted: ['ada@example.com', 'grace@example.com'],
			rejected: ['bob@example.com'],
			response: '250 OK',
		});
	});

	test('Takes the envelope as accepted when the transport reports no acceptance', () => {
		// sendmail and stream transports only know the message left the process; the envelope is all there is
		expect(toMailResult({ messageId: '<x>', envelope: { to: ['ada@example.com'] } })).toStrictEqual({
			messageId: '<x>',
			accepted: ['ada@example.com'],
			rejected: [],
			response: undefined,
		});

		expect(toMailResult({ accepted: [], envelope: { to: ['ada@example.com'] } })).toMatchObject({ accepted: [] });

		expect(toMailResult({})).toStrictEqual({ messageId: undefined, accepted: [], rejected: [], response: undefined });
	});
});
