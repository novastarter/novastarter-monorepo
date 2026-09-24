import { getJobContract } from '../contracts/index.js';
import type { JobContext, JobContract } from '../types.js';
import { getJobHandler } from './handlers.js';

/**
 * Run a job of a known contract: the schema checks the payload, the registered handler runs it.
 *
 * What {@link runJob} does once it has the contract; the `local` driver holds the contract already and calls
 * this directly.
 *
 * @param contract - The job's contract.
 * @param payload - The payload as delivered; parsed again here, defaults applied.
 * @param context - Id, attempt and enqueue time of this run.
 * @returns When the handler is done.
 * @throws Error when no handler is registered for the contract; InvalidPayloadError when the payload does not
 * match; whatever the handler throws.
 */
export const runContract = async (contract: JobContract, payload: unknown, context: JobContext): Promise<void> => {
	// The handler must be there before the payload is checked: a missing handler is the deployment's problem, a
	// bad payload the sender's, and the error should say which
	const handler = getJobHandler(contract);

	if (!handler) {
		throw new Error(`No handler registered for job "${contract.name}"`);
	}

	// Parsed on the way in, so the handler sees exactly what the contract promises
	await handler(contract.parse(payload), context);
};

/**
 * Run a job by name in this process: the contract's schema checks the payload, the registered handler runs it.
 *
 * The one path every execution goes through — the `local` driver right after `enqueue()`, and the web app's
 * receiver when a worker delivers a job over HTTP — so a payload is never handed to a handler unchecked, whichever
 * way it arrived.
 *
 * @param name - The job, `<queue>.<action>`.
 * @param payload - The payload as delivered; parsed again here, defaults applied.
 * @param context - Id, attempt and enqueue time of this run.
 * @returns When the handler is done.
 * @throws Error when no contract or no handler is registered under the name; InvalidPayloadError when the payload
 * does not match the contract; whatever the handler throws.
 *
 * @example
 * ```ts
 * await runJob('mail.send', body.payload, {
 * 	id: body.id,
 * 	name: 'mail.send',
 * 	attempt: body.attempt,
 * 	enqueuedAt,
 * });
 * ```
 */
export const runJob = async (name: string, payload: unknown, context: JobContext): Promise<void> => {
	// The contract, or an error naming the job — a receiver turns that into "unknown job"
	await runContract(getJobContract(name), payload, context);
};
