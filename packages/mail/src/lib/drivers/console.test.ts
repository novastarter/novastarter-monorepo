/**
 * Tests of the `console` mail driver.
 */
import { describe, expect, test, vi } from 'vitest';
import { MailDriverConsole } from './console.js';

describe('MailDriverConsole', () => {
	test('Logs the message and accepts every recipient', async () => {
		// 1. A recording logger stands in for the application's
		const logger = { info: vi.fn() };
		const driver = new MailDriverConsole({ logger: logger as any });

		const result = await driver.send({
			to: ['ada@example.com', { name: 'Grace', address: 'grace@example.com' }],
			cc: ['cc@example.com'],
			from: { name: 'Acme', address: 'no-reply@acme.test' },
			subject: 'Welcome',
			text: 'Hello',
			html: '<p>Hello</p>',
			category: 'transactional',
		});

		// 2. The result carries bare addresses; the log line the readable forms, html left out
		expect(result).toStrictEqual({ accepted: ['ada@example.com', 'grace@example.com'], rejected: [] });

		expect(logger.info).toHaveBeenCalledWith(
			{
				to: ['ada@example.com', 'Grace <grace@example.com>'],
				cc: ['cc@example.com'],
				from: 'Acme <no-reply@acme.test>',
				subject: 'Welcome',
				category: 'transactional',
				text: 'Hello',
			},
			'Mail: Welcome',
		);
	});

	test('Includes the html only when asked', async () => {
		// 1. `includeHtml` is the one switch: with it the html joins the log line
		const logger = { info: vi.fn() };
		const driver = new MailDriverConsole({ logger: logger as any, includeHtml: true });

		await driver.send({ to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>' });

		expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>Hi</p>' }), 'Mail: Hi');
	});

	test('Logs a call with its method and parameters, files by name, and answers nothing', async () => {
		const logger = { info: vi.fn() };

		// 1. The same call a provider's driver takes, written to the log; the options are not logged
		await expect(
			new MailDriverConsole({ logger: logger as any }).call(
				'POST /v1/files',
				{ purpose: 'import', file: new File(['x'], 'data.csv'), raw: new Blob(['y']) },
				{ headers: { authorization: 'secret' } },
			),
		).resolves.toBeUndefined();

		expect(logger.info).toHaveBeenCalledWith(
			{ method: 'POST /v1/files', params: { purpose: 'import', file: 'data.csv', raw: 'blob' } },
			'Mail call POST /v1/files',
		);
	});
});
