/**
 * Tests of `queue/types`: the shapes the package speaks, type-only.
 */
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from './lib/define-job.js';
import type {
	EnqueuedJob,
	EnqueueOptions,
	JobContext,
	JobInput,
	JobPayload,
	JobRegistry,
	QueueStats,
} from './types.js';
import * as types from './types.js';

test('ships no runtime code', () => {
	// 1. Types only: nothing here may end up in a consumer's bundle
	expect(Object.keys(types)).toEqual([]);
});

test('JobInput is the payload before parsing, JobPayload after', () => {
	// 1. A field with a default may be left out by the caller, and is always present for the handler
	const contract = defineJob({
		name: 'mail.send',
		schema: z.object({ to: z.email(), count: z.number().int().default(1) }),
	});

	const input: JobInput<typeof contract> = { to: 'ada@example.com' };
	const payload: JobPayload<typeof contract> = { to: 'ada@example.com', count: 1 };

	expect(contract.parse(input)).toStrictEqual(payload);
});

test('JobContext describes one run of a job', () => {
	// 1. The context is what a handler learns besides the payload: the driver's id of the run, the job's name, the
	//    attempt and when the job was enqueued, with an abort signal only a timed run carries
	const context: JobContext = {
		id: '7',
		name: 'mail.send',
		attempt: 2,
		enqueuedAt: new Date('2026-09-10T12:00:00.000Z'),
	};

	expectTypeOf(context.signal).toEqualTypeOf<AbortSignal | undefined>();
	expect(context.attempt).toBe(2);
});

test('EnqueueOptions overrides a contract without replacing it', () => {
	// 1. Only the per-call knobs exist here; everything a contract already decides stays out
	expectTypeOf<EnqueueOptions>().toEqualTypeOf<{
		delay?: number;
		priority?: number;
		attempts?: number;
		jobId?: string;
	}>();
});

test('EnqueuedJob and QueueStats answer what a caller looks up afterwards', () => {
	// 1. The identity of an enqueue is enough to find the job again in logs and in the driver
	const enqueued: EnqueuedJob = { id: '1', name: 'mail.send', queue: 'mail' };

	// 2. Stats report one entry per queue, with the states every driver counts
	const stats: QueueStats = { name: 'mail', counts: { waiting: 1, active: 0, delayed: 0, failed: 0, completed: 2 } };

	expect(enqueued.queue).toBe('mail');
	expect(stats.counts.completed).toBe(2);
});

test('JobRegistry starts empty for the application to augment', () => {
	// 1. With no augmentation there is no known job name; the application adds its own contracts by declaring them
	expectTypeOf<keyof JobRegistry>().toEqualTypeOf<never>();
});
