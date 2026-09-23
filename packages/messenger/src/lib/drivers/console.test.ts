/**
 * Tests of the `console` messenger driver.
 */
import { describe, expect, test, vi } from 'vitest';
import { MessengerDriverConsole } from './console.js';

describe('MessengerDriverConsole', () => {
	test('Logs the text and hands out sequential ids', async () => {
		// 1. A recording logger stands in for the application's
		const logger = { info: vi.fn() };
		const driver = new MessengerDriverConsole({ logger: logger as any });

		await expect(driver.send({ to: '42', text: 'Paid' })).resolves.toStrictEqual({ messageId: 'console-1' });
		await expect(driver.send({ to: '42', text: 'Again' })).resolves.toStrictEqual({ messageId: 'console-2' });

		// 2. One line per message with the recipient and the text
		expect(logger.info).toHaveBeenNthCalledWith(1, { to: '42', messageId: 'console-1' }, 'Messenger to 42: Paid');
	});

	test('Names the attachments instead of dumping them', async () => {
		const logger = { info: vi.fn() };

		// 1. A URL is named as is, a file by its name, a nameless blob as `blob`
		await new MessengerDriverConsole({ logger: logger as any }).send({
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
});
