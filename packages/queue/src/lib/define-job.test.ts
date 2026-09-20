/**
 * Tests of `queue/lib/define-job`.
 */
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { DEFAULT_JOB_OPTIONS, defineJob } from './define-job.js';

const schema = z.object({ to: z.email(), count: z.number().int().default(1) });

describe('defineJob', () => {
	test('Splits the name into queue and action and applies the default options', () => {
		const job = defineJob({ name: 'mail.send', schema });

		expect(job).toMatchObject({ name: 'mail.send', queue: 'mail', action: 'send', options: DEFAULT_JOB_OPTIONS });
		expect(job.schema).toBe(schema);
	});

	test('Merges the given options over the defaults', () => {
		const job = defineJob({ name: 'mail.send', schema, options: { attempts: 5, unique: true } });

		expect(job.options).toStrictEqual({ ...DEFAULT_JOB_OPTIONS, attempts: 5, unique: true });
	});

	test.each(['send', 'mail.send.now', 'Mail.send', 'mail_x.send', '.send', 'mail.', '1mail.send'])(
		'Refuses the name %s',
		(name) => {
			expect(() => defineJob({ name, schema })).toThrow(TypeError);
		},
	);

	test('Parses a payload, applying defaults', () => {
		const job = defineJob({ name: 'mail.send', schema });

		expect(job.parse({ to: 'ada@example.com' })).toStrictEqual({ to: 'ada@example.com', count: 1 });
	});

	test('Reports every issue of an invalid payload at once', () => {
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
