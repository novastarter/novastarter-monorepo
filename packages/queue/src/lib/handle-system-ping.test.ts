import { describe, expect, test, vi } from 'vitest';
import { createSystemPingHandler } from './handle-system-ping.js';

vi.mock('@novastarter/logger', () => ({
	useLogger: vi.fn(),
}));

const { useLogger } = await import('@novastarter/logger');

const context = { id: 'job-1', name: 'system.ping', attempt: 2, enqueuedAt: new Date(Date.now() - 250) };

describe('createSystemPingHandler', () => {
	test('logs the message, the id, the wait since the enqueue and the attempt', async () => {
		const logger = { info: vi.fn() };
		const handler = createSystemPingHandler({ logger: logger as never });

		await handler({ message: 'scheduled ping' }, context);

		expect(logger.info).toHaveBeenCalledTimes(1);

		const [line] = logger.info.mock.calls[0] as [string];

		expect(line).toMatch(/^Ping "scheduled ping" \(job-1\) arrived after \d+ ms on attempt 2$/);

		// 1. The wait is measured from the enqueue, so it is at least the 250 ms the context claims
		expect(Number(/after (\d+) ms/.exec(line)![1])).toBeGreaterThanOrEqual(250);
	});

	test('measures from the payload’s own stamp when it carries one', async () => {
		const logger = { info: vi.fn() };
		const handler = createSystemPingHandler({ logger: logger as never });

		await handler({ message: 'ping', at: new Date(Date.now() - 5_000).toISOString() }, context);

		expect(Number(/after (\d+) ms/.exec((logger.info.mock.calls[0] as [string])[0])![1])).toBeGreaterThanOrEqual(5_000);
	});

	test('writes to the app’s logger when none is given', async () => {
		const logger = { info: vi.fn() };

		vi.mocked(useLogger).mockReturnValue(logger as never);

		await createSystemPingHandler()({ message: 'ping' }, context);

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Ping "ping" (job-1)'));
	});
});
