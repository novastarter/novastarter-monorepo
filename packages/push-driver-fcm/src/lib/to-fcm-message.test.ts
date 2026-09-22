/**
 * Tests of `to-fcm-message`: how a message and the location defaults become FCM's `Message` for a token.
 */
import { describe, expect, test } from 'vitest';
import { toFcmMessage } from './to-fcm-message.js';

/**
 * A fixed clock, so the APNs expiration header is a known number.
 */
const now = new Date('2026-09-11T12:00:00Z');

describe('toFcmMessage', () => {
	test('Maps the notification, the data with the url, and the platform blocks', () => {
		// 1. Every field set: the text in the common block, the rest where each platform reads it
		expect(
			toFcmMessage(
				{
					token: 'tok',
					title: 'Paid',
					body: 'Invoice #1',
					url: 'https://app.example/billing',
					icon: '/icon.png',
					badge: '/badge.png',
					image: 'https://app.example/big.png',
					tag: 'invoice-1',
					data: { invoiceId: '1' },
					ttl: 60,
					urgency: 'high',
				},
				{ analyticsLabel: 'billing' },
				now,
			),
		).toStrictEqual({
			token: 'tok',
			notification: { title: 'Paid', body: 'Invoice #1', imageUrl: 'https://app.example/big.png' },
			data: { invoiceId: '1', url: 'https://app.example/billing' },
			android: { priority: 'high', ttl: 60_000, collapseKey: 'invoice-1', notification: { tag: 'invoice-1' } },
			apns: {
				headers: {
					'apns-priority': '10',
					'apns-expiration': String(Math.floor(now.getTime() / 1000) + 60),
					'apns-collapse-id': 'invoice-1',
				},
				payload: { aps: { sound: 'default', 'mutable-content': 1 } },
				fcmOptions: { imageUrl: 'https://app.example/big.png' },
			},
			webpush: {
				headers: { Urgency: 'high', TTL: '60' },
				notification: {
					icon: '/icon.png',
					badge: '/badge.png',
					image: 'https://app.example/big.png',
					tag: 'invoice-1',
					data: { invoiceId: '1', url: 'https://app.example/billing' },
				},
				fcmOptions: { link: 'https://app.example/billing' },
			},
			fcmOptions: { analyticsLabel: 'billing' },
		});

		// 2. The bare minimum: no data block, normal priority, a relative url stays out of the web link
		expect(toFcmMessage({ token: 'tok', title: 'Hi', url: '/x' }, { ttl: 3600 }, now)).toMatchObject({
			notification: { title: 'Hi' },
			data: { url: '/x' },
			android: { priority: 'normal', ttl: 3_600_000 },
			apns: { headers: { 'apns-priority': '5' }, payload: { aps: { sound: 'default' } } },
			webpush: { headers: { Urgency: 'normal', TTL: '3600' }, notification: { data: { url: '/x' } } },
		});

		expect(toFcmMessage({ token: 'tok', title: 'Hi' }).webpush).not.toHaveProperty('fcmOptions');
		expect(toFcmMessage({ token: 'tok', title: 'Hi' })).not.toHaveProperty('data');
	});

	test('Keeps a relative image out of the blocks FCM checks as URLs, so the text still goes out', () => {
		// 1. The SDK refuses the whole message for an `imageUrl` that is not an absolute http(s) URL; the web block is
		//    the one place a relative image is both allowed and useful
		const relative = toFcmMessage({ token: 'tok', title: 'Paid', image: '/big.png' }, {}, now);

		expect(relative.notification).toStrictEqual({ title: 'Paid' });
		expect(relative.apns).toStrictEqual({ headers: { 'apns-priority': '5' }, payload: { aps: { sound: 'default' } } });
		expect(relative.webpush?.notification).toMatchObject({ image: '/big.png' });

		// 2. Plain http is an absolute URL the SDK accepts, so it reaches every block like https does
		const http = toFcmMessage({ token: 'tok', title: 'Paid', image: 'http://cdn.example/big.png' }, {}, now);

		expect(http.notification).toMatchObject({ imageUrl: 'http://cdn.example/big.png' });

		expect(http.apns).toMatchObject({
			payload: { aps: { 'mutable-content': 1 } },
			fcmOptions: { imageUrl: 'http://cdn.example/big.png' },
		});
	});

	test('Refuses a message without a token', () => {
		// 1. A subscription is the webpush driver's business; the mapper throws for a direct caller without a token
		expect(() => toFcmMessage({ title: 'Hi' })).toThrow(/needs a token/);
	});

	test('Maps a ttl of 0 to "now or never" on every platform', () => {
		// 1. APNs reads "now or never" from an expiration of `0`; the send time as a timestamp would be a message
		//    already expired on arrival, while Android and the web take the zero as is
		expect(toFcmMessage({ token: 'tok', title: 'Ring', ttl: 0 }, { ttl: 3600 }, now)).toMatchObject({
			android: { ttl: 0 },
			apns: { headers: { 'apns-expiration': '0' } },
			webpush: { headers: { TTL: '0' } },
		});

		// 2. A positive ttl is still the absolute time it runs out at
		expect(toFcmMessage({ token: 'tok', title: 'Ring', ttl: 5 }, {}, now).apns?.headers).toMatchObject({
			'apns-expiration': String(Math.floor(now.getTime() / 1000) + 5),
		});
	});

	test('Sanitises the APNs collapse id while Android and the web keep the whole tag', () => {
		// 1. Only APNs has the byte limit and the header alphabet: FCM relays the header as given and APNs answers
		//    BadCollapseId past it, while the Android collapse key and the web tag take the tag whole
		const tag = 'ё'.repeat(40);

		expect(toFcmMessage({ token: 'tok', title: 'Hi', tag }, {}, now)).toMatchObject({
			android: { collapseKey: tag, notification: { tag } },
			apns: { headers: { 'apns-collapse-id': '_'.repeat(40) } },
			webpush: { notification: { tag } },
		});
	});
});
