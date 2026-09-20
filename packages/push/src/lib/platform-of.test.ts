/**
 * Tests of `push/lib/platform-of` and `to-web-push-payload`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { platformOf } from './platform-of.js';
import { toWebPushPayload } from './to-web-push-payload.js';

const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('platformOf', () => {
	test('Tells the platform from the target and refuses a message with none, both, or a broken subscription', () => {
		// 1. A subscription is web push; a token is FCM unless the message says APNs, and nothing else
		expect(platformOf({ subscription })).toBe('webpush');
		expect(platformOf({ token: 'tok' })).toBe('fcm');
		expect(platformOf({ token: 'tok', platform: 'apns' })).toBe('apns');
		expect(() => platformOf({ token: 'tok', platform: 'sms' as never })).toThrow('not a platform');

		// 2. No target, two targets or an empty token are the payload's fault
		expect(() => platformOf({})).toThrow(InvalidPayloadError);
		expect(() => platformOf({ subscription, token: 'tok' })).toThrow(/either a subscription or a token/);
		expect(() => platformOf({ token: ' ' })).toThrow(/token is empty/);
		// 3. A subscription without an https endpoint or without both keys cannot be delivered to
		expect(() => platformOf({ subscription: { ...subscription, endpoint: 'http://x' } })).toThrow(/https endpoint/);

		expect(() =>
			platformOf({ subscription: { endpoint: subscription.endpoint, keys: { p256dh: '', auth: 'a' } } }),
		).toThrow(/p256dh \/ auth keys/);
	});
});

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
