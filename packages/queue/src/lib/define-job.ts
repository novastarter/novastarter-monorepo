import { InvalidPayloadError } from '@novastarter/errors';
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { zodErrorToErrorExtensions } from '@novastarter/validation';
import { z } from 'zod';
import type { JobContract, JobOptions } from '../types.js';

/**
 * Shape of a job name: `<queue>.<action>`, lower-case words with digits and dashes, exactly one dot.
 *
 * @defaultValue `/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/`
 */
export const JOB_NAME_PATTERN: RegExp = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/**
 * Retry settings a contract gets when it names none.
 *
 * @defaultValue 3 tries with exponential backoff from 1 s, completed records dropped.
 */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
	attempts: 3,
	backoff: { type: 'exponential', delay: 1_000 },
	removeOnComplete: true,
};

/**
 * What {@link defineJob} takes.
 *
 * @typeParam Name - The job's name.
 * @typeParam Schema - Zod schema of the payload.
 */
export interface DefineJobOptions<Name extends string, Schema extends z.ZodType> {
	name: Name;
	schema: Schema;
	/** Merged over {@link DEFAULT_JOB_OPTIONS}. */
	options?: JobOptions;
}

/**
 * Describe a job: its name, the payload it accepts and how it runs.
 *
 * Pure — nothing is registered; `registerJob()` does that, so a contract can be built in a test without touching the
 * process-wide registry. The name decides the queue: everything before the dot.
 *
 * @typeParam Name - The job's name.
 * @typeParam Schema - Zod schema of the payload.
 * @param definition - Name, schema and options.
 * @returns The contract.
 * @throws TypeError for a name that is not `<queue>.<action>`; `RangeError` for a `timeout` that is negative, `NaN`
 * or above `MAX_TIMER_DELAY` — refused here, where the contract is written, rather than failing every run of the
 * job in the worker.
 *
 * @example
 * ```ts
 * export const mailSend = defineJob({
 * 	name: 'mail.send',
 * 	schema: z.object({
 * 	to: z.email(),
 * 	subject: z.string(),
 * }),
 * 	options: { attempts: 5 },
 * });
 * ```
 */
export const defineJob = <Name extends string, Schema extends z.ZodType>(
	definition: DefineJobOptions<Name, Schema>,
): JobContract<Name, Schema> => {
	// 1. Both are needed on their own below — the name for the validation, the schema for the returned contract
	const { name, schema } = definition;

	// 2. The name is an identifier that ends up in Redis keys, log lines and URLs, so it is kept strict
	if (!JOB_NAME_PATTERN.test(name)) {
		throw new TypeError(`Job name "${name}" must look like <queue>.<action>: lower-case words, one dot`);
	}

	// 3. The caller's options win over the defaults; a timeout no timer can hold is refused now, since the worker
	//    would otherwise fail every run of the job with a `RangeError` and retry it for nothing
	const options = { ...DEFAULT_JOB_OPTIONS, ...definition.options };

	if (options.timeout !== undefined && !(options.timeout >= 0 && options.timeout <= MAX_TIMER_DELAY)) {
		throw new RangeError(
			`Job "${name}" has a "timeout" of ${options.timeout}; it must be between 0 and ${MAX_TIMER_DELAY} ms`,
		);
	}

	// 4. The queue is everything before the dot, the action the rest; the pattern guaranteed exactly one dot
	const [queue, action] = name.split('.') as [string, string];

	return {
		name,
		queue,
		action,
		schema,
		options,
		parse: (payload) => {
			// 1. `safeParse` rather than `parse`, so the issues are reported in the package's own error, not zod's
			const result = schema.safeParse(payload);

			if (result.success) return result.data;

			// 2. Every issue is reported at once, so a caller fixes the payload in one round. The reason quotes zod's own
			//    messages — a refinement's text survives, unlike in the `FailedValidationError` extensions of
			//    `@novastarter/validation`, which ride along as `cause` for a handler that wants to answer the way an API does
			const error = result.error as z.ZodError;
			const reasons = error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);

			throw new InvalidPayloadError(
				{ reason: `Job "${name}" payload: ${reasons.join('; ')}` },
				{ cause: zodErrorToErrorExtensions(error) },
			);
		},
	};
};
