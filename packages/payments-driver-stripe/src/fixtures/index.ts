/**
 * Readers of the webhook fixtures next to this file, shared by the tests of the driver and of its mappings — the
 * module is reached from the tests only and is not part of the package's build.
 */
import { readFileSync } from 'node:fs';
import type Stripe from 'stripe';

/**
 * A fixture event, as text — the bytes a signature covers.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The JSON text.
 */
export const fixtureText = (name: string): string => readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');

/**
 * A fixture event, parsed.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The event object.
 */
export const fixture = (name: string): Stripe.Event => JSON.parse(fixtureText(name)) as Stripe.Event;
