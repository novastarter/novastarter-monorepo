/**
 * Tests of `queue/lib/load-bullmq`.
 */
import { ErrorCode } from '@novastarter/errors';
import { expect, test, vi } from 'vitest';
import { loadBullmq } from './load-bullmq.js';

test('Answers the bullmq module, loading it once', async () => {
	// The real module is installed in this workspace; what is under test is that both calls share one load
	const first = loadBullmq();
	const second = loadBullmq();

	expect(second).toBe(first);
	expect(await first).toBe(await import('bullmq'));
});

test('Refuses a missing bullmq package with the install hint', async () => {
	vi.resetModules();

	vi.doMock('bullmq', () => {
		throw new Error("Cannot find package 'bullmq'");
	});

	try {
		const { loadBullmq: loadMissing } = await import('./load-bullmq.js');
		const refused = loadMissing();

		// Matched by code, not class: `resetModules` gave this import its own copy of `@novastarter/errors`
		await expect(refused).rejects.toMatchObject({
			code: ErrorCode.InvalidConfig,
			message: 'Invalid config. The bullmq queue driver needs the "bullmq" package; install it with `pnpm add bullmq`.',
		});
	} finally {
		vi.doUnmock('bullmq');
		vi.resetModules();
	}
});
