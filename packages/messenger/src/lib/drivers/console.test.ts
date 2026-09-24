/**
 * Tests of the `console` messenger driver.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { MessengerDriverConsole } from './console.js';

describe('MessengerDriverConsole', () => {
	test('Logs the text and hands out sequential ids', async () => {
		const logger = { info: vi.fn() };
		const driver = new MessengerDriverConsole({ logger: logger as unknown as Logger });

		await expect(driver.send({ to: '42', text: 'Paid' })).resolves.toStrictEqual({ messageId: 'console-1' });
		await expect(driver.send({ to: '42', text: 'Again' })).resolves.toStrictEqual({ messageId: 'console-2' });

		expect(logger.info).toHaveBeenNthCalledWith(1, { to: '42', messageId: 'console-1' }, 'Messenger to 42: Paid');
	});

	test('Names the attachments instead of dumping them', async () => {
		const logger = { info: vi.fn() };

		await new MessengerDriverConsole({ logger: logger as unknown as Logger }).send({
			to: '42',
			attachments: [
				{ kind: 'photo', source: 'https://example.com/a.png' },
				{ kind: 'document', source: new Blob(['x']), filename: 'invoice.pdf' },
				{ kind: 'document', source: new Blob(['y']) },
			],
		});

		expect(logger.info).toHaveBeenCalledWith(
			{
				to: '42',
				attachments: [
					{ kind: 'photo', source: 'https://example.com/a.png' },
					{ kind: 'document', source: 'invoice.pdf' },
					{ kind: 'document', source: 'blob' },
				],
				messageId: 'console-1',
			},
			'Messenger to 42: 3 attachment(s)',
		);
	});

	test('Logs a call with its method and parameters, files by name, and answers nothing', async () => {
		const logger = { info: vi.fn() };

		await expect(
			new MessengerDriverConsole({ logger: logger as unknown as Logger }).call('sendPhoto', {
				chat_id: '42',
				photo: new File(['png'], 'chart.png'),
				thumbnail: new Blob(['x']),
			}),
		).resolves.toStrictEqual({ status: 200, headers: {}, data: undefined });

		expect(logger.info).toHaveBeenCalledWith(
			{ method: 'sendPhoto', params: { chat_id: '42', photo: 'chart.png', thumbnail: 'blob' } },
			'Messenger call sendPhoto',
		);
	});

	test('Answers a plain 200 with no headers and no body', async () => {
		// Code that reads the status of a real provider's answer runs against the console too
		await expect(
			new MessengerDriverConsole({ logger: { info: vi.fn() } as unknown as Logger }).call('GET /v1/x'),
		).resolves.toStrictEqual({ status: 200, headers: {}, data: undefined });
	});
});
