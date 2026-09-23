/**
 * Tests of `notifications/lib/channels/in-app` on the real in-process bus of `@novastarter/memory`.
 */
import { BusDriverLocal, useBus } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { InAppRecord } from '../../types.js';
import { IN_APP_BUS_PREFIX, inAppChannel } from './in-app.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * One delivery of a paid invoice to `u1`.
 */
const DELIVERY = {
	notification: { type: 'invoice.paid', userId: 'u1', data: { invoice: '1042' } },
	recipient: { userId: 'u1' },
	content: { title: 'Invoice paid', url: '/billing' },
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	useBus().registerLocation('default', { driver: 'local', options: {} });
});

afterEach(async () => {
	vi.useRealTimers();
	await useBus().close();
	useBus.reset();
});

describe('inAppChannel', () => {
	test('Reaches every user', () => {
		// 1. The inbox needs no address
		expect(inAppChannel({ save: async () => undefined }).reaches({ userId: 'u1' })).toBe(true);
	});

	test('Saves the record, then announces it on the user’s bus channel', async () => {
		const saved: InAppRecord[] = [];
		const announced: unknown[] = [];

		await useBus()
			.location()
			.subscribe(`${IN_APP_BUS_PREFIX}u1`, (payload) => {
				announced.push(payload);
			});

		// 1. The record carries the content, the notification's type and data, a fresh id and the time
		await inAppChannel({ save: async (record) => void saved.push(record) }).send(DELIVERY);

		expect(saved).toStrictEqual([
			{
				title: 'Invoice paid',
				url: '/billing',
				id: expect.stringMatching(/^[0-9a-f-]{36}$/),
				userId: 'u1',
				type: 'invoice.paid',
				data: { invoice: '1042' },
				createdAt: NOW,
			},
		]);

		// 2. An open page hears the same record
		await vi.waitFor(() => expect(announced).toStrictEqual(saved));
	});

	test('Announces nothing with the bus turned off', async () => {
		const publish = vi.spyOn(BusDriverLocal.prototype, 'publish');

		// 1. Saved only
		await inAppChannel({ save: async () => undefined, bus: false }).send(DELIVERY);

		expect(publish).not.toHaveBeenCalled();
	});
});
