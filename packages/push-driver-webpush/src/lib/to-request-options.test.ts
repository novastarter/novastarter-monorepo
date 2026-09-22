/**
 * Tests of `to-request-options`: how a message and the location defaults become `sendNotification()` options.
 */
import { describe, expect, test } from 'vitest';
import webpush from 'web-push';
import { toRequestOptions, toTopic } from './to-request-options.js';

/**
 * A real VAPID pair, so the details land in the options exactly as the library would sign with them.
 */
const keys = webpush.generateVAPIDKeys();

/**
 * A `mailto:` subject, the form every push service accepts.
 */
const subject = 'mailto:ops@example.com';

/**
 * A browser subscription with placeholder keys; the mapping never decodes them.
 */
const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('toTopic', () => {
	test('Cuts the tag to the URL-safe alphabet and the length limit, dropping an empty one', () => {
		// 1. Anything outside the alphabet becomes `_`, so a dotted or colon-separated tag still collapses
		expect(toTopic('invoice.paid:42')).toBe('invoice_paid_42');
		expect(toTopic('::')).toBe('__');

		// 2. The push services refuse a longer topic, so it is cut rather than rejected
		expect(toTopic('x'.repeat(40))).toHaveLength(32);

		// 3. No tag means no header at all, never an empty one
		expect(toTopic('')).toBeUndefined();
		expect(toTopic(undefined)).toBeUndefined();
	});
});

describe('toRequestOptions', () => {
	test('Maps ttl, urgency, tag and the location defaults to the library keys', () => {
		// 1. Every option maps to the library's key; the message's ttl wins over the location's default
		expect(
			toRequestOptions(
				{ subscription, title: 'Hi', tag: 'a b', ttl: 60, urgency: 'high' },
				{ ...keys, subject, ttl: 3600, timeout: 5000, proxy: 'http://proxy:3128' },
			),
		).toStrictEqual({
			vapidDetails: { subject, ...keys },
			contentEncoding: 'aes128gcm',
			urgency: 'high',
			TTL: 60,
			topic: 'a_b',
			timeout: 5000,
			proxy: 'http://proxy:3128',
		});
	});

	test('Fills in the location defaults and leaves absent options out entirely', () => {
		// 1. The location's ttl fills in; urgency and encoding fall back to the spec defaults
		expect(toRequestOptions({ subscription, title: 'Hi' }, { ...keys, subject, ttl: 3600 })).toStrictEqual({
			vapidDetails: { subject, ...keys },
			contentEncoding: 'aes128gcm',
			urgency: 'normal',
			TTL: 3600,
		});

		// 2. Nothing optional set means no key at all, so the library never sees an `undefined` value
		expect(toRequestOptions({ subscription, title: 'Hi' }, { ...keys, subject })).toStrictEqual({
			vapidDetails: { subject, ...keys },
			contentEncoding: 'aes128gcm',
			urgency: 'normal',
		});
	});
});
