/**
 * Tests of the `sms.send` job on the `local` queue of `@novastarter/queue` and the `console` driver of
 * `@novastarter/sms`.
 *
 * `@novastarter/logger` is mocked; `sendSms` is spied on through its package.
 */
import { useLogger } from '@novastarter/logger';
import { _handlers, enqueue, getJobContract, registerJobHandlers, useQueue } from '@novastarter/queue';
import { sendSms, useSms } from '@novastarter/sms';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmsSendHandler, smsSend, toSmsMessage } from './sms-send';

vi.mock('@novastarter/logger');

// The real `sendSms` runs, wrapped so one test can make it fail
vi.mock('@novastarter/sms', async (importOriginal) => {
	const original = await importOriginal<typeof import('@novastarter/sms')>();

	return { ...original, sendSms: vi.fn(original.sendSms) };
});

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);

	// Every test enqueues on a local default location and sends through one console location, as the bootstrap
	// registers them without Redis and without a provider
	useQueue().registerLocation('default', {
		driver: 'local',
		options: {},
	});

	useSms().registerLocation('console', {
		driver: 'console',
		options: {
			logger: logger as any,
		},
	});

	useSms().registerRoutes({ from: 'Acme' });
});

afterEach(() => {
	_handlers.clear();
	useQueue.reset();
	useSms.reset();
	vi.clearAllMocks();
});

describe('sms.send', () => {
	test('Is registered with the queue when the module loads', () => {
		// 1. Importing the module is what makes `enqueue('sms.send', …)` known; nothing else registers it
		expect(getJobContract('sms.send')).toBe(smsSend);
		expect(smsSend).toMatchObject({ queue: 'sms', action: 'send' });
	});

	test('Normalises the recipient and needs a number in E.164 and a text', () => {
		// 1. A number typed with separators or a `00` prefix is accepted and stored as E.164
		expect(smsSend.parse({ to: '0044 (7700) 900-123', text: 'Hi' })).toStrictEqual({
			to: '+447700900123',
			text: 'Hi',
			route: 'transactional',
		});

		// 2. A national number would need its country guessed; refused with the form to use
		expect(() => smsSend.parse({ to: '4155550123', text: 'Hi' })).toThrow(/E.164/);
		expect(() => smsSend.parse({ to: '+14155550123', text: '' })).toThrow(/text: /);

		// 3. A location by name overrides the route
		expect(smsSend.parse({ to: '+14155550123', text: 'Hi', route: 'marketing', location: 'bulk' })).toMatchObject({
			route: 'marketing',
			location: 'bulk',
		});
	});

	test('Retries five times with growing waits', () => {
		// 1. The contract's options are what `enqueue()` starts from; a caller may still override them per job
		expect(smsSend.options).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 5_000 } });
	});
});

describe('toSmsMessage', () => {
	test('Drops the job-only fields and turns the route into the category', () => {
		expect(
			toSmsMessage({
				to: '+14155550123',
				text: 'Your code is 123456',
				from: '+14155550100',
				route: 'marketing',
				location: 'bulk',
				ttl: 600,
				reference: 'signup-1',
			}),
		).toStrictEqual({
			to: '+14155550123',
			text: 'Your code is 123456',
			from: '+14155550100',
			category: 'marketing',
			ttl: 600,
			reference: 'signup-1',
		});
	});
});

describe('createSmsSendHandler', () => {
	test('Delivers an enqueued sms.send through the local queue into the console driver', async () => {
		registerJobHandlers({ 'sms.send': createSmsSendHandler() });

		await enqueue('sms.send', { to: '+1 415 555 0123', text: 'Your code is 123456' });

		// 1. The console driver logged the message with the sender of the routes and the normalised recipient
		expect(logger.info).toHaveBeenCalledWith(
			{ to: '+14155550123', from: 'Acme', category: 'transactional', text: 'Your code is 123456' },
			'SMS: +14155550123',
		);
	});

	test('Honours the location of the payload and lets a failing send reach the queue', async () => {
		vi.mocked(sendSms).mockRejectedValueOnce(new Error('down'));

		const handler = createSmsSendHandler();

		// 1. The handler throws what `sendSms` threw, so the queue retries by the contract's rules
		await expect(
			handler(
				{ to: '+14155550123', text: 'Hi', route: 'transactional', location: 'console' },
				{ id: '1', name: 'sms.send', attempt: 1, enqueuedAt: new Date() },
			),
		).rejects.toThrow('down');

		expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi' }), { location: 'console' });
	});
});
