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

	test('Uses the notification’s id, so a retried job saves the same record instead of a duplicate', async () => {
		const saved: InAppRecord[] = [];
		const delivery = { ...DELIVERY, notification: { ...DELIVERY.notification, id: 'event-1042' } };

		// 1. The same notification delivered twice: what a job retry after `save()` succeeded but the publish failed
		//    looks like
		await inAppChannel({ save: async (record) => void saved.push(record) }).send(delivery);
		await inAppChannel({ save: async (record) => void saved.push(record) }).send(delivery);

		// 2. The record's id is the notification's, scoped to the user, so the application's save can upsert on it
		expect(saved.map((record) => record.id)).toStrictEqual(['u1:event-1042', 'u1:event-1042']);
	});

	test('Gives each recipient of one event its own record id, so an upsert does not overwrite another user’s row', async () => {
		const saved: InAppRecord[] = [];

		// 1. One event, one notification per user, both carrying the event's id
		for (const userId of ['u1', 'u2']) {
			const delivery = { ...DELIVERY, notification: { ...DELIVERY.notification, userId, id: 'comment-77' } };
			await inAppChannel({ save: async (record) => void saved.push(record) }).send(delivery);
		}

		// 2. The ids differ per user, so an inbox keyed on the id keeps both rows
		expect(saved.map((record) => record.id)).toStrictEqual(['u1:comment-77', 'u2:comment-77']);
	});

	test('Gives a record without a notification id a fresh one, so a plain re-send still works', async () => {
		const saved: InAppRecord[] = [];

		// 1. A notification that carries no id: two deliveries are two records, each with its own id
		await inAppChannel({ save: async (record) => void saved.push(record) }).send(DELIVERY);
		await inAppChannel({ save: async (record) => void saved.push(record) }).send(DELIVERY);

		// 2. The ids differ, and they are the uuid shape the inbox test above pins down
		expect(saved[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(saved[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(saved[0]?.id).not.toBe(saved[1]?.id);
	});
});
