/**
 * Tests of the `console` SMS driver.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { SmsDriverConsole } from './console.js';

describe('SmsDriverConsole', () => {
	test('Logs the message and answers a logged status', async () => {
		const logger = { info: vi.fn() };
		const driver = new SmsDriverConsole({ logger: logger as unknown as Logger });

		const result = await driver.send({
			to: '+14155550123',
			from: 'Acme',
			text: 'Your code is 123456',
			category: 'transactional',
		});

		// No provider answers, so the result only says the line was written.
		expect(result).toStrictEqual({ status: 'logged' });

		expect(logger.info).toHaveBeenCalledWith(
			{ to: '+14155550123', from: 'Acme', category: 'transactional', text: 'Your code is 123456' },
			'SMS: +14155550123',
		);
	});

	test('Leaves the optional fields out of the line when unset', async () => {
		const logger = { info: vi.fn() };
		const driver = new SmsDriverConsole({ logger: logger as unknown as Logger });

		await driver.send({ to: '+14155550123', text: 'Hi' });

		expect(logger.info).toHaveBeenCalledWith({ to: '+14155550123', text: 'Hi' }, 'SMS: +14155550123');
	});

	test('Logs a call with its method and parameters, files by name, and answers nothing', async () => {
		const logger = { info: vi.fn() };

		await expect(
			new SmsDriverConsole({ logger: logger as unknown as Logger }).call(
				'POST /v1/files',
				{ purpose: 'import', file: new File(['x'], 'data.csv'), raw: new Blob(['y']) },
				{ headers: { authorization: 'secret' } },
			),
		).resolves.toStrictEqual({ status: 200, headers: {}, data: undefined });

		expect(logger.info).toHaveBeenCalledWith(
			{ method: 'POST /v1/files', params: { purpose: 'import', file: 'data.csv', raw: 'blob' } },
			'Sms call POST /v1/files',
		);
	});

	test('Answers a plain 200 with no headers and no body', async () => {
		// Code that reads the status of a real provider's answer runs against the console too.
		await expect(
			new SmsDriverConsole({ logger: { info: vi.fn() } as unknown as Logger }).call('GET /v1/x'),
		).resolves.toStrictEqual({
			status: 200,
			headers: {},
			data: undefined,
		});
	});
});
