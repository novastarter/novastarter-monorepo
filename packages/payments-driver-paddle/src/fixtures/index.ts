/**
 * Readers of the webhook fixtures next to this file, shared by the tests of the driver and of its mappings — the
 * module is reached from the tests only and is not part of the package's build.
 */
import { readFileSync } from 'node:fs';
import { type EventEntity, Webhooks } from '@paddle/paddle-node-sdk';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Paddle event type it carries.
 * @returns The JSON text.
 */
export const fixtureText = (name: string): string => readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');

/**
 * A fixture's event, parsed the way the SDK parses a notification.
 *
 * @param name - The fixture.
 * @returns The event entity.
 */
export const parsed = (name: string): EventEntity => Webhooks.fromJson(JSON.parse(fixtureText(name)));
