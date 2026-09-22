/**
 * Readers of the webhook fixtures next to this file, shared by the tests of the driver and of its mappings — the
 * module is reached from the tests only and is not part of the package's build.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateEvent } from '@polar-sh/sdk/webhooks';

/**
 * The secret the fixtures are signed with.
 *
 * @defaultValue `polar-webhook-secret`
 */
export const WEBHOOK_SECRET = 'polar-webhook-secret';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Polar event type it carries.
 * @returns The JSON text.
 */
export const fixtureText = (name: string): string => {
	// 1. Read the file as text rather than JSON, since the signature covers the exact bytes Polar would send
	return readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');
};

/**
 * Standard Webhooks headers for a body: `v1,<base64 hmac of "id.timestamp.body">` with the raw secret as the key,
 * which is what Polar's `validateEvent` expects after it base64-encodes the secret for the library.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @param id - The delivery id.
 * @returns The three headers.
 */
export const sign = (
	body: string,
	secret: string = WEBHOOK_SECRET,
	id: string = 'msg_2abc',
): { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string } => {
	// 1. A current timestamp, since the verifier refuses one outside its tolerance window
	const timestamp = String(Math.floor(Date.now() / 1000));

	// 2. The signed string is `id.timestamp.body`, the Standard Webhooks layout, with the secret as the raw HMAC key
	const signature = `v1,${createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')}`;

	return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature };
};

/**
 * A fixture through the SDK's own parser, for the mapping tests.
 *
 * @param name - The fixture.
 * @returns What `validateEvent` hands the driver.
 */
export const parsed = (name: string): ReturnType<typeof validateEvent> => {
	// 1. Sign the fixture and let the SDK verify and parse it, so the mappings see exactly the shapes the driver does
	const body = fixtureText(name);

	return validateEvent(body, sign(body), WEBHOOK_SECRET);
};
