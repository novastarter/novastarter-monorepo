/**
 * Tests of `queue/lib/load-bullmq`.
 */
import { expect, test } from 'vitest';
import { loadBullmq } from './load-bullmq.js';

test('Answers the bullmq module, loading it once', async () => {
	// 1. The real module is installed in this workspace; what is under test is that both calls share one load
	const first = loadBullmq();
	const second = loadBullmq();

	expect(second).toBe(first);
	expect(await first).toBe(await import('bullmq'));
});
