/**
 * Tests of the `console` SMS driver.
 */
import { describe, expect, test, vi } from 'vitest';
import { SmsDriverConsole } from './console.js';

describe('SmsDriverConsole', () => {
	test('Logs the message and answers a logged status', async () => {
		// 1. A recording logger stands in for the application's
		const logger = { info: vi.fn() };
		const driver = new SmsDriverConsole({ logger: logger as any });

		const result = await driver.send({
			to: '+14155550123',
			from: 'Acme',
			text: 'Your code is 123456',
			category: 'transactional',
		});

		// 2. No provider answers, so the result only says the line was written
		expect(result).toStrictEqual({ status: 'logged' });

		expect(logger.info).toHaveBeenCalledWith(
			{ to: '+14155550123', from: 'Acme', category: 'transactional', text: 'Your code is 123456' },
			'SMS: +14155550123',
		);
	});

	test('Leaves the optional fields out of the line when unset', async () => {
		// 1. A message without sender or category logs only what it has, so the line carries no `undefined` keys
		const logger = { info: vi.fn() };
		const driver = new SmsDriverConsole({ logger: logger as any });

		await driver.send({ to: '+14155550123', text: 'Hi' });

		expect(logger.info).toHaveBeenCalledWith({ to: '+14155550123', text: 'Hi' }, 'SMS: +14155550123');
	});

	test('Logs a call with its method and parameters, files by name, and answers nothing', async () => {
		const logger = { info: vi.fn() };

		// 1. The same call a provider's driver takes, written to the log; the options are not logged
		await expect(
			new SmsDriverConsole({ logger: logger as any }).call(
				'POST /v1/files',
				{ purpose: 'import', file: new File(['x'], 'data.csv'), raw: new Blob(['y']) },
				{ headers: { authorization: 'secret' } },
			),
		).resolves.toBeUndefined();

		expect(logger.info).toHaveBeenCalledWith(
			{ method: 'POST /v1/files', params: { purpose: 'import', file: 'data.csv', raw: 'blob' } },
			'Sms call POST /v1/files',
		);
	});
});
