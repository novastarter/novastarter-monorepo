/**
 * Tests of the `system.ping` job: its registration with `@novastarter/queue`, its development schedule and its
 * handler. `@novastarter/logger` is mocked.
 */
import { useLogger } from '@novastarter/logger';
import { getJobContract, getSchedules } from '@novastarter/queue';
import { describe, expect, test, vi } from 'vitest';
import { createSystemPingHandler, DEV_PING_SCHEDULE, systemPing } from './system-ping';

vi.mock('@novastarter/logger');

const context = { id: 'job-1', name: 'system.ping', attempt: 2, enqueuedAt: new Date(Date.now() - 250) };

describe('system.ping', () => {
	test('Is registered with the queue when the module loads', () => {
		// 1. Importing the module is what makes `enqueue('system.ping', …)` known; nothing else registers it
		expect(getJobContract('system.ping')).toBe(systemPing);
		expect(systemPing).toMatchObject({ queue: 'system', action: 'ping', options: { attempts: 1 } });
	});

	test('Defaults the message and validates the stamp', () => {
		// 1. An empty payload becomes the default ping
		expect(systemPing.parse({})).toStrictEqual({ message: 'ping' });

		// 2. The stamp must be ISO 8601 — the schema names it in the error
		expect(() => systemPing.parse({ at: 'yesterday' })).toThrow(/at/);
	});

	test('Schedules itself every five minutes in development only', () => {
		const schedule = { job: 'system.ping', cron: DEV_PING_SCHEDULE, payload: { message: 'scheduled ping' } };

		// 1. The schedule is data the worker's `startSchedules()` reads; the switch is the environment's
		expect(getSchedules({})).toContainEqual({ ...schedule, enabled: false });
		expect(getSchedules({ NODE_ENV: 'development' })).toContainEqual({ ...schedule, enabled: true });
	});
});

describe('createSystemPingHandler', () => {
	test('Logs the message, the id, the wait since the enqueue and the attempt', async () => {
		// 1. A logger mock and the handler wired to it, so the logged line can be read back
		const logger = { info: vi.fn() };
		const handler = createSystemPingHandler({ logger: logger as never });

		// 2. One ping through the handler writes exactly one line, with the message, the id and the attempt
		await handler({ message: 'scheduled ping' }, context);

		expect(logger.info).toHaveBeenCalledTimes(1);

		const [line] = logger.info.mock.calls[0] as [string];

		expect(line).toMatch(/^Ping "scheduled ping" \(job-1\) arrived after \d+ ms on attempt 2$/);

		// 3. The wait is measured from the enqueue, so it is at least the 250 ms the context claims
		expect(Number(/after (\d+) ms/.exec(line)![1])).toBeGreaterThanOrEqual(250);
	});

	test('Measures from the payload’s own stamp when it carries one', async () => {
		// 1. A logger mock and the handler wired to it, so the logged line can be read back
		const logger = { info: vi.fn() };
		const handler = createSystemPingHandler({ logger: logger as never });

		// 2. A ping stamped five seconds ago measures its wait from the stamp, not from the context's enqueue time
		await handler({ message: 'ping', at: new Date(Date.now() - 5_000).toISOString() }, context);

		expect(Number(/after (\d+) ms/.exec((logger.info.mock.calls[0] as [string])[0])![1])).toBeGreaterThanOrEqual(5_000);
	});

	test('Writes to the app’s logger when none is given', async () => {
		// 1. The app logger is the mocked `useLogger()`, so its return value is where the handler's line lands
		const logger = { info: vi.fn() };

		vi.mocked(useLogger).mockReturnValue(logger as never);

		// 2. No logger passed: the handler asks `useLogger()` and writes the ping there
		await createSystemPingHandler()({ message: 'ping' }, context);

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Ping "ping" (job-1)'));
	});
});
