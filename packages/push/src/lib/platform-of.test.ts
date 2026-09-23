/**
 * Tests of `push/lib/platform-of`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { platformOf } from './platform-of.js';

/**
 * A browser subscription with everything `platformOf()` checks for; the broken cases are built from it.
 */
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

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
		// 3. A subscription without an https endpoint cannot be delivered to
		expect(() => platformOf({ subscription: { ...subscription, endpoint: 'http://x' } })).toThrow(/https endpoint/);

		// 4. The endpoint is client-supplied, so only known push service hosts pass: internal names, IP literals,
		//    look-alikes and credentials tricks are refused, while every browser's push service and its subdomains pass
		for (const endpoint of [
			'https://internal-admin.svc.cluster.local/api/reset',
			'https://10.0.0.5:8443/x',
			'https://localhost/x',
			'https://evilpush.apple.com/x',
			'https://fcm.googleapis.com.evil.example/x',
			'https://fcm.googleapis.com@evil.example/x',
		]) {
			expect(() => platformOf({ subscription: { ...subscription, endpoint } })).toThrow(/not a known push service/);
		}

		for (const endpoint of [
			'https://updates.push.services.mozilla.com/wpush/v2/abc',
			'https://web.push.apple.com/abc',
			'https://wns2-par02p.notify.windows.com/w/?token=abc',
			'https://FCM.googleapis.com./fcm/send/abc',
		]) {
			expect(platformOf({ subscription: { ...subscription, endpoint } })).toBe('webpush');
		}

		// 5. Both keys are needed to encrypt the payload

		expect(() =>
			platformOf({ subscription: { endpoint: subscription.endpoint, keys: { p256dh: '', auth: 'a' } } }),
		).toThrow(/p256dh \/ auth keys/);
	});
});
