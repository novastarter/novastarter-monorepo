/**
 * Readers of the webhook fixtures next to this file, shared by the tests of the driver and of its mappings — the
 * module is reached from the tests only and is not part of the package's build.
 */
import { readFileSync } from 'node:fs';
import type { LsWebhookPayload } from '../types.js';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Lemon Squeezy event it carries.
 * @returns The JSON text.
 */
export const fixtureText = (name: string): string => readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');

/**
 * A fixture, parsed.
 *
 * @typeParam A - The attributes of the resource the fixture carries.
 * @param name - The fixture.
 * @returns The delivery.
 */
export const fixture = <A = unknown>(name: string): LsWebhookPayload<A> =>
	JSON.parse(fixtureText(name)) as LsWebhookPayload<A>;
