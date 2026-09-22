/**
 * Tests of `to-apns-notification`: how a message becomes the SDK's notification, its priority and its collapse id.
 */
import { Priority } from 'apns2';
import { describe, expect, test } from 'vitest';
import { APNS_COLLAPSE_ID_MAX_LENGTH } from './constants.js';
import { toApnsNotification, toApnsPriority, toCollapseId } from './to-apns-notification.js';

describe('toApnsPriority', () => {
	test('Maps the urgency onto 10 / 5 / 1', () => {
		// 1. Four urgencies on our side, three priorities on Apple's: both low ones share the lowest
		expect(toApnsPriority('high')).toBe(Priority.immediate);
		expect(toApnsPriority('normal')).toBe(Priority.throttled);
		expect(toApnsPriority(undefined)).toBe(Priority.throttled);
		expect(toApnsPriority('low')).toBe(Priority.low);
		expect(toApnsPriority('very-low')).toBe(Priority.low);
	});
});

describe('toCollapseId', () => {
	test('Keeps the safe alphabet, replaces the rest, cuts to 64 bytes and drops an empty tag', () => {
		// 1. Letters, digits and `_ . : -` pass; anything else would make the HTTP client refuse the header
		expect(toCollapseId('invoice.paid:42')).toBe('invoice.paid:42');
		expect(toCollapseId('счёт-42')).toBe('____-42');
		expect(toCollapseId('a b/c')).toBe('a_b_c');

		// 2. An emoji is one code point, so one `_` — not one per surrogate half
		expect(toCollapseId('a😀b')).toBe('a_b');

		// 3. The limit is bytes: forty two-byte letters would be 80 bytes verbatim, so the cut happens after the
		//    replacement, where a character is a byte
		expect(toCollapseId('ё'.repeat(40))).toBe('_'.repeat(40));
		expect(toCollapseId('x'.repeat(100))).toBe('x'.repeat(APNS_COLLAPSE_ID_MAX_LENGTH));
		expect(Buffer.byteLength(toCollapseId('ё'.repeat(100)) as string)).toBe(APNS_COLLAPSE_ID_MAX_LENGTH);
		expect(Buffer.byteLength(toCollapseId('😀'.repeat(100)) as string)).toBe(APNS_COLLAPSE_ID_MAX_LENGTH);

		// 4. No tag, no header
		expect(toCollapseId('')).toBeUndefined();
		expect(toCollapseId(undefined)).toBeUndefined();
	});
});

describe('toApnsNotification', () => {
	test('Builds the alert with the data at the top level, the collapse id and the expiration', () => {
		const now = new Date('2026-09-12T00:00:00Z');

		// 1. Every field set: the message's ttl wins over the location's, the tag is cut to the collapse id limit
		const notification = toApnsNotification(
			{
				token: 'tok',
				title: 'Hi',
				body: 'There',
				url: '/dashboard',
				image: 'https://cdn/img.png',
				tag: 'x'.repeat(100),
				data: { kind: 'invoice' },
				ttl: 60,
				urgency: 'high',
			},
			{ topic: 'com.example.app', ttl: 3600 },
			now,
		);

		// 2. The token, the type and the priority are the client's own fields; the rest are its options
		expect(notification.deviceToken).toBe('tok');
		expect(notification.pushType).toBe('alert');
		expect(notification.priority).toBe(Priority.immediate);

		expect(notification.options).toMatchObject({
			topic: 'com.example.app',
			alert: { title: 'Hi', body: 'There' },
			expiration: Math.floor(now.getTime() / 1000) + 60,
			collapseId: 'x'.repeat(APNS_COLLAPSE_ID_MAX_LENGTH),
			sound: 'default',
			mutableContent: true,
			data: { kind: 'invoice', url: '/dashboard', image: 'https://cdn/img.png' },
		});

		// 3. The payload APNs receives: the alert under `aps`, the custom pairs at the top level for the app
		expect(notification.buildApnsOptions()).toStrictEqual({
			aps: { alert: { title: 'Hi', body: 'There' }, sound: 'default', 'mutable-content': 1 },
			kind: 'invoice',
			url: '/dashboard',
			image: 'https://cdn/img.png',
		});
	});

	test('Sanitizes the tag into the collapse id', () => {
		// 1. A tag the HTTP client would refuse as a header value reaches the options in its safe form
		const notification = toApnsNotification({ token: 'tok', title: 'Hi', tag: 'счёт-42' }, { topic: 't' });

		expect(notification.options.collapseId).toBe('____-42');
	});

	test('Takes the location ttl and sound, an empty body for a title alone, and no data block when empty', () => {
		const now = new Date('2026-09-12T00:00:00Z');

		const notification = toApnsNotification(
			{ token: 'tok', title: 'Hi', tag: '' },
			{ topic: 't', ttl: 0, sound: '' },
			now,
		);

		// 1. The bare minimum: a ttl of 0 is "now or never", an empty sound is silence, an empty tag no collapse id,
		//    no data key at all
		expect(notification.options).toStrictEqual({
			type: 'alert',
			topic: 't',
			alert: { title: 'Hi', body: '' },
			priority: Priority.throttled,
			expiration: 0,
		});
	});
});
