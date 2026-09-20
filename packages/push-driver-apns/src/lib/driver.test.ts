/**
 * Tests of the APNs driver with the client injected; the SDK's own classes (notifications, errors) are real.
 */
import { generateKeyPairSync } from 'node:crypto';
import { PushTargetGoneError } from '@novastarter/push';
import { ApnsClient, ApnsError, Host, Notification, Priority } from 'apns2';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, {
	assertSigningKey,
	COLLAPSE_ID_MAX_LENGTH,
	describeError,
	PushDriverApns,
	toApnsNotification,
	toApnsPriority,
} from './index.js';

/**
 * A fresh P-256 key in PEM, the shape of an APNs auth key.
 */
const p256Pem = (): string =>
	generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

/**
 * An RSA key in PEM — a private key APNs would refuse.
 */
const rsaPem = (): string =>
	generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const signingKey = p256Pem();
const send = vi.fn();
const close = vi.fn();
const client = { send, close };
const credentials = { teamId: 'TEAM1', keyId: 'KEY1', signingKey, topic: 'com.example.app', client };

/**
 * An `ApnsError` the way the client raises it for a refusal.
 */
const refusal = (statusCode: number, reason: string): ApnsError =>
	new ApnsError({ statusCode, notification: new Notification('tok'), response: { reason, timestamp: Date.now() } });

afterEach(() => {
	vi.clearAllMocks();
});

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

	test('Takes the location ttl and sound, an empty body for a title alone, and no data block when empty', () => {
		const now = new Date('2026-09-12T00:00:00Z');
		const notification = toApnsNotification({ token: 'tok', title: 'Hi' }, { topic: 't', ttl: 0, sound: '' }, now);

		// 1. The bare minimum: a ttl of 0 is "now or never", an empty sound is silence, no data key at all
		expect(notification.options).toStrictEqual({
			type: 'alert',
			topic: 't',
			alert: { title: 'Hi', body: '' },
			priority: Priority.throttled,
			expiration: 0,
		});
	});
});

describe('describeError', () => {
	test('A dead token is a PushTargetGoneError, another refusal names the status and reason', () => {
		// 1. The three reasons that mean the token is dead, whatever the status
		const gone = describeError(refusal(410, 'Unregistered'));

		expect(gone).toBeInstanceOf(PushTargetGoneError);

		expect((gone as InstanceType<typeof PushTargetGoneError>).extensions).toStrictEqual({
			platform: 'apns',
			reason: 'Unregistered',
		});

		expect(describeError(refusal(400, 'BadDeviceToken'))).toBeInstanceOf(PushTargetGoneError);
		expect(describeError(refusal(400, 'DeviceTokenNotForTopic'))).toBeInstanceOf(PushTargetGoneError);

		// 2. Any other refusal names the status and the reason, the client's error as the cause
		const other = describeError(refusal(403, 'InvalidProviderToken'));

		expect(other).not.toBeInstanceOf(PushTargetGoneError);
		expect(other.message).toBe('APNs 403 InvalidProviderToken');
		expect(other.cause).toBeInstanceOf(ApnsError);

		// 3. A network failure is prefixed and passed on
		expect(describeError(new Error('socket hang up')).message).toBe('APNs: socket hang up');
	});
});

describe('assertSigningKey', () => {
	test('Accepts a P-256 key and refuses anything else', () => {
		// 1. Only the curve ES256 signs with passes; an RSA key and a non-key are refused by name
		expect(() => assertSigningKey(signingKey)).not.toThrow();
		expect(() => assertSigningKey(rsaPem())).toThrow('P-256');
		expect(() => assertSigningKey('not a key')).toThrow('not a PEM private key');
	});
});

describe('PushDriverApns', () => {
	test('Requires the credentials and the topic', () => {
		// 1. Configuration errors are reported by the options' names; the key is checked at construction
		expect(() => new PushDriverApns({ ...credentials, teamId: '' })).toThrow('"teamId"');
		expect(() => new PushDriverApns({ ...credentials, topic: '' })).toThrow('"topic"');
		expect(() => new PushDriverApns({ ...credentials, signingKey: rsaPem() })).toThrow('P-256');
	});

	test('Unescapes the key of a .env line and builds the client for production or the sandbox', () => {
		const escaped = signingKey.replace(/\n/g, '\\n');
		const production = new PushDriverApns({ ...credentials, signingKey: escaped, client: undefined });
		const sandbox = new PushDriverApns({ ...credentials, client: undefined, production: false, requestTimeout: 5000 });

		// 1. The clients are the SDK's, on the host the environment picks
		const productionClient = (production as unknown as { client: ApnsClient }).client;
		const sandboxClient = (sandbox as unknown as { client: ApnsClient }).client;

		expect(productionClient).toBeInstanceOf(ApnsClient);
		expect(productionClient.host).toBe(Host.production);
		expect(productionClient.signingKey).toBe(signingKey);
		expect(productionClient.defaultTopic).toBe('com.example.app');
		expect(sandboxClient.host).toBe(Host.development);

		return Promise.all([production.close(), sandbox.close()]);
	});

	test('Sends the notification for the token and answers accepted', async () => {
		send.mockResolvedValueOnce(new Notification('tok'));

		// 1. APNs hands out no id the client exposes, so the result is the status alone
		const driver = new PushDriverApns(credentials);
		const result = await driver.send({ token: 'tok', title: 'Hi', body: 'There', platform: 'apns' });

		expect(result).toStrictEqual({ status: 'accepted' });
		expect(send).toHaveBeenCalledTimes(1);

		// 2. The notification carries the token and the location's topic
		const notification = send.mock.calls[0]?.[0] as Notification;

		expect(notification.deviceToken).toBe('tok');
		expect(notification.options.topic).toBe('com.example.app');
	});

	test('Refuses a subscription, passes a gone token on, names another refusal', async () => {
		const driver = new PushDriverApns(credentials);

		// 1. A subscription is the webpush driver's business
		await expect(
			driver.send({ subscription: { endpoint: 'https://p', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow('needs a token');

		// 2. A dead token is the error the caller deletes it on; any other refusal is named
		send.mockRejectedValueOnce(refusal(410, 'Unregistered'));
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toBeInstanceOf(PushTargetGoneError);

		send.mockRejectedValueOnce(refusal(429, 'TooManyRequests'));
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toThrow('APNs 429 TooManyRequests');
	});

	test('Verifies the key and closes the client', async () => {
		const driver = new PushDriverApns(credentials);

		// 1. The key passes offline; `close()` reaches the client, injected or not
		await expect(driver.verify()).resolves.toBeUndefined();
		await driver.close();
		expect(close).toHaveBeenCalledTimes(1);
	});

	test('Is the default export too', () => {
		// 1. Both import forms hand out the same class
		expect(defaultExport).toBe(PushDriverApns);
	});
});
