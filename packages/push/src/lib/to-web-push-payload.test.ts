/**
 * Tests of `push/lib/to-web-push-payload`.
 */
import { describe, expect, test } from 'vitest';
import { toWebPushPayload } from './to-web-push-payload.js';

/**
 * A browser subscription with everything `platformOf()` checks for; the payload never reads it.
 */
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('toWebPushPayload', () => {
	test('Keeps what is set and tucks the url into data', () => {
		// 1. Every field set: the url joins the custom data, where the service worker reads it on click
		expect(
			toWebPushPayload({
				subscription,
				title: 'Paid',
				body: 'Invoice #1',
				icon: '/icon.png',
				tag: 'invoice-1',
				url: '/dashboard/billing',
				data: { invoiceId: '1' },
			}),
		).toStrictEqual({
			title: 'Paid',
			body: 'Invoice #1',
			icon: '/icon.png',
			tag: 'invoice-1',
			data: { invoiceId: '1', url: '/dashboard/billing' },
		});

		// 2. The bare minimum: no undefined keys, an empty data object
		expect(toWebPushPayload({ subscription, title: 'Hi' })).toStrictEqual({ title: 'Hi', data: {} });
	});
});
