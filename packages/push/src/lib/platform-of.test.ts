/**
 * Tests of `push/lib/platform-of`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { platformOf } from './platform-of.js';

/**
 * A browser subscription with everything `platformOf()` checks for; the broken cases are built from it.
 */
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
