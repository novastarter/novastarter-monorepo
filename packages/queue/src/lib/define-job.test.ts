/**
 * Tests of `queue/lib/define-job`.
 */
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { DEFAULT_JOB_OPTIONS, defineJob } from './define-job.js';

const schema = z.object({ to: z.email(), count: z.number().int().default(1) });

describe('defineJob', () => {
	test('Splits the name into queue and action and applies the default options', () => {
		// 1. The name becomes queue and action; the options are the package defaults unless overridden
		const job = defineJob({ name: 'mail.send', schema });

		expect(job).toMatchObject({ name: 'mail.send', queue: 'mail', action: 'send', options: DEFAULT_JOB_OPTIONS });
		expect(job.schema).toBe(schema);
	});

	test('Merges the given options over the defaults', () => {
		// 1. Only the given options change; the rest of the defaults stay
		const job = defineJob({ name: 'mail.send', schema, options: { attempts: 5, unique: true } });

		expect(job.options).toStrictEqual({ ...DEFAULT_JOB_OPTIONS, attempts: 5, unique: true });
	});

	test.each(['send', 'mail.send.now', 'Mail.send', 'mail_x.send', '.send', 'mail.', '1mail.send'])(
		'Refuses the name %s',
		(name) => {
			// 1. Every shape outside `<queue>.<action>` is refused before a contract exists
			expect(() => defineJob({ name, schema })).toThrow(TypeError);
		},
	);

	test('Refuses a timeout a timer cannot hold, where the contract is written rather than at every run', () => {
		// 1. Negative, `NaN` and overlong timeouts are refused at definition time
		expect(() => defineJob({ name: 'mail.send', schema, options: { timeout: -1 } })).toThrow(RangeError);
		expect(() => defineJob({ name: 'mail.send', schema, options: { timeout: Number.NaN } })).toThrow(RangeError);

		// 2. The message names the offending value, so a bad timeout is findable among a list of contracts
		expect(() => defineJob({ name: 'mail.send', schema, options: { timeout: Number.POSITIVE_INFINITY } })).toThrow(
			`Job "mail.send" has a "timeout" of Infinity; it must be between 0 and ${MAX_TIMER_DELAY} ms`,
		);

		// 3. The upper bound itself is a delay a timer can hold
		expect(defineJob({ name: 'mail.send', schema, options: { timeout: MAX_TIMER_DELAY } }).options.timeout).toBe(
			MAX_TIMER_DELAY,
		);
	});

	test('Parses a payload, applying defaults', () => {
		// 1. Defaults are applied at parse time, so the handler always sees a complete payload
		const job = defineJob({ name: 'mail.send', schema });

		expect(job.parse({ to: 'ada@example.com' })).toStrictEqual({ to: 'ada@example.com', count: 1 });
	});

	test('Reports every issue of an invalid payload at once', () => {
		// 1. One thrown error carries every issue, so a caller learns all that is wrong in a single round
		const job = defineJob({ name: 'mail.send', schema });

		expect(() => job.parse({ to: 'nope', count: 1.5 })).toThrow(
			expect.objectContaining({
				code: 'INVALID_PAYLOAD',
				extensions: { reason: expect.stringMatching(/^Job "mail.send" payload: to: .*; count: /) },
				cause: [expect.objectContaining({ field: 'to' }), expect.objectContaining({ field: 'count' })],
			}),
		);
	});
});
