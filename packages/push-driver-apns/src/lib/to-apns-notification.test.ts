/**
 * Tests of `to-apns-notification`: how a message becomes the SDK's notification, its priority and its collapse id.
 */
import { COLLAPSE_ID_MAX_LENGTH } from '@novastarter/push';
import { Priority } from 'apns2';
import { describe, expect, test } from 'vitest';
import { toApnsNotification, toApnsPriority } from './to-apns-notification.js';

describe('toApnsPriority', () => {
	test('Maps the urgency onto 10 or 5', () => {
		// 1. Four urgencies on our side, two priorities an alert push may use on Apple's: priority 1 is refused with
		//    BadPriority, so both low ones take 5, the power-friendly moment, exactly like `normal`
		expect(toApnsPriority('high')).toBe(Priority.immediate);
		expect(toApnsPriority('normal')).toBe(Priority.throttled);
		expect(toApnsPriority(undefined)).toBe(Priority.throttled);
		expect(toApnsPriority('low')).toBe(Priority.throttled);
		expect(toApnsPriority('very-low')).toBe(Priority.throttled);
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
			collapseId: 'x'.repeat(COLLAPSE_ID_MAX_LENGTH),
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

	test('Refuses a message without a token', () => {
		// 1. A subscription is the webpush driver's business; the mapper throws for a direct caller without a token
		expect(() => toApnsNotification({ title: 'Hi' }, { topic: 't' })).toThrow(/needs a token/);
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
