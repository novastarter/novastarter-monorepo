/**
 * Tests of the `mail.send` job on the `local` queue of `@novastarter/queue` and the `console` driver of
 * `@novastarter/mail`.
 *
 * `@novastarter/logger` is mocked; `sendMail` is spied on through its package.
 */
import { useLogger } from '@novastarter/logger';
import { sendMail, useMail } from '@novastarter/mail';
import { _handlers, enqueue, getJobContract, registerJobHandlers, useQueue } from '@novastarter/queue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMailSendHandler, mailSend, toMailMessage } from './mail-send';

vi.mock('@novastarter/logger');

// The real `sendMail` runs, wrapped so one test can make it fail
vi.mock('@novastarter/mail', async (importOriginal) => {
	const original = await importOriginal<typeof import('@novastarter/mail')>();

	return { ...original, sendMail: vi.fn(original.sendMail) };
});

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * A renderer standing in for the app's templates.
 */
const render = vi.fn(
	async (template: string, props: Record<string, unknown>, options: { locale?: string | undefined }) => ({
		subject: `[${options.locale ?? 'en'}] ${template}`,
		html: `<p>${template} ${JSON.stringify(props)}</p>`,
		text: `${template} ${JSON.stringify(props)}`,
	}),
);

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);

	// Every test enqueues on a local default location and sends through one console location, as the bootstrap
	// registers them without Redis and without a provider
	useQueue().registerLocation('default', {
		driver: 'local',
		options: {},
	});

	useMail().registerLocation('console', {
		driver: 'console',
		options: {
			logger: logger as any,
		},
	});

	useMail().registerRoutes({ from: { name: 'Acme', address: 'no-reply@acme.test' } });
});

afterEach(() => {
	_handlers.clear();
	useQueue.reset();
	useMail.reset();
	vi.clearAllMocks();
});

describe('mail.send', () => {
	test('Is registered with the queue when the module loads', () => {
		// 1. Importing the module is what makes `enqueue('mail.send', …)` known; nothing else registers it
		expect(getJobContract('mail.send')).toBe(mailSend);
		expect(mailSend).toMatchObject({ queue: 'mail', action: 'send' });
	});

	test('Needs a recipient, a subject and some body; the route defaults to transactional', () => {
		// 1. A template stands in for both subject and body
		expect(
			mailSend.parse({
				to: 'ada@example.com',
				template: 'welcome',
				props: { url: 'https://x' },
				locale: 'ru',
			}),
		).toMatchObject({
			route: 'transactional',
			template: 'welcome',
			locale: 'ru',
		});

		// 2. Without a template both the subject and a body are required, and named in the error
		expect(
			mailSend.parse({ to: [{ name: 'Ada', address: 'ada@example.com' }], subject: 'Hi', text: 'Hello' }),
		).toMatchObject({
			to: [{ name: 'Ada', address: 'ada@example.com' }],
		});

		expect(() => mailSend.parse({ to: 'ada@example.com', subject: 'Hi' })).toThrow(/body is required/);
		expect(() => mailSend.parse({ to: 'ada@example.com', html: '<p>x</p>' })).toThrow(/subject is required/);

		// 3. Recipients are addresses, at least one
		expect(() => mailSend.parse({ to: 'nope', subject: 'Hi', text: 'x' })).toThrow(/to: /);
		expect(() => mailSend.parse({ to: [], subject: 'Hi', text: 'x' })).toThrow(/to: /);

		// 4. A location by name overrides the route
		expect(mailSend.parse({ to: 'ada@example.com', subject: 'Hi', text: 'x', location: 'bulk' })).toMatchObject({
			location: 'bulk',
		});
	});

	test('Retries five times with growing waits', () => {
		// 1. The contract's options are what `enqueue()` starts from; a caller may still override them per job
		expect(mailSend.options).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 5_000 } });
	});
});

describe('toMailMessage', () => {
	test('Renders a template payload and carries the rest over; an explicit subject wins', async () => {
		const message = await toMailMessage(
			{
				to: 'ada@example.com',
				template: 'welcome',
				props: { url: 'https://x' },
				locale: 'ru',
				route: 'marketing',
				location: 'bulk',
				tags: ['welcome'],
				headers: { 'X-Campaign': 'w' },
			},
			render,
		);

		// 1. The renderer got the payload's template, props and locale
		expect(render).toHaveBeenCalledWith('welcome', { url: 'https://x' }, { locale: 'ru' });

		// 2. The job-only fields are gone; the route became the category
		expect(message).toStrictEqual({
			to: 'ada@example.com',
			subject: '[ru] welcome',
			html: '<p>welcome {"url":"https://x"}</p>',
			text: 'welcome {"url":"https://x"}',
			category: 'marketing',
			tags: ['welcome'],
			headers: { 'X-Campaign': 'w' },
		});

		// 3. A subject given next to a template overrides the rendered one
		const overridden = await toMailMessage(
			{ to: 'a@b.c', template: 'welcome', subject: 'Custom', route: 'transactional' },
			render,
		);

		expect(overridden.subject).toBe('Custom');
	});

	test('Passes a ready body through and refuses a template without a renderer', async () => {
		// 1. No template, nothing to render: the payload is the message
		expect(await toMailMessage({ to: 'a@b.c', subject: 'Hi', text: 'x', route: 'transactional' })).toStrictEqual({
			to: 'a@b.c',
			subject: 'Hi',
			text: 'x',
			category: 'transactional',
		});

		// 2. A template without a renderer is a configuration error of the app
		await expect(toMailMessage({ to: 'a@b.c', template: 'welcome', route: 'transactional' })).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
		});
	});
});

describe('createMailSendHandler', () => {
	test('Delivers an enqueued mail.send through the local queue into the console driver', async () => {
		registerJobHandlers({ 'mail.send': createMailSendHandler({ render }) });

		await enqueue('mail.send', {
			to: 'ada@example.com',
			template: 'verify-email',
			props: { url: 'https://acme.test/v' },
		});

		// 1. The console driver logged the rendered message with the sender of the routes
		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				to: ['ada@example.com'],
				subject: '[en] verify-email',
				from: 'Acme <no-reply@acme.test>',
			}),
			'Mail: [en] verify-email',
		);
	});

	test('Honours the location of the payload and lets a failing send reach the queue', async () => {
		vi.mocked(sendMail).mockRejectedValueOnce(new Error('down'));

		const handler = createMailSendHandler({ render });

		// 1. The handler throws what `sendMail` threw, so the queue retries by the contract's rules
		await expect(
			handler(
				{ to: 'a@b.c', subject: 'Hi', text: 'x', route: 'transactional', location: 'console' },
				{ id: '1', name: 'mail.send', attempt: 1, enqueuedAt: new Date() },
			),
		).rejects.toThrow('down');

		expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Hi' }), { location: 'console' });
	});
});
