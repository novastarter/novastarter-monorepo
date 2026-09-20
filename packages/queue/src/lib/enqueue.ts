import { useEmitter } from '@novastarter/emitter';
import { getJobContract } from '../contracts/index.js';
import type { EnqueuedJob, EnqueueOptions, JobContract, JobInput, JobName, JobRegistry } from '../types.js';
import { getJobId } from './get-job-id.js';
import { useQueue } from './use-queue.js';

/**
 * Action event emitted after a job was accepted by the provider; the meta carries `id`, `name`, `queue` and the
 * parsed `payload`.
 *
 * @defaultValue `job.enqueued`
 */
export const JOB_ENQUEUED_EVENT = 'job.enqueued';

/**
 * Payload of a job by name, as the caller passes it.
 */
export type JobInputOf<Name extends JobName> = JobRegistry[Name] extends JobContract
	? JobInput<JobRegistry[Name]>
	: never;

/**
 * Put a job on the queue.
 *
 * The one entry point for background work: the payload is checked against the contract (an invalid one throws
 * `InvalidPayloadError` right here, in the caller's request, not in a worker), the id is derived, the provider takes
 * it, and `job.enqueued` is emitted for anyone listening — the activity log, metrics.
 *
 * @typeParam Name - A job of the {@link JobRegistry}.
 * @param name - Job name.
 * @param payload - Payload as the contract's schema expects it.
 * @param options - Delay, priority, attempts, explicit id.
 * @returns The job's identity.
 * @throws InvalidPayloadError for a payload the contract rejects; whatever the provider throws.
 *
 * @example
 * ```ts
 * await enqueue('mail.send', {
 * 	to: user.email,
 * 	subject: 'Welcome',
 * 	template: 'welcome',
 * 	data: {
 * 		name,
 * 	},
 * });
 * await enqueue('retention.run', {}, { delay: 60_000 });
 * ```
 */
export const enqueue = async <Name extends JobName>(
	name: Name,
	payload: JobInputOf<Name>,
	options: EnqueueOptions = {},
): Promise<EnqueuedJob> => {
	const contract = getJobContract(name);

	// 1. Validation happens where the bug is: a bad payload fails the caller, never a worker hours later
	const parsed = contract.parse(payload);

	// 2. The contract's options are the baseline; the call may tighten or loosen them
	const effective = { ...contract.options, ...options };
	const id = getJobId(contract, parsed, effective);

	// 3. The queue of the job picks the location: its own when the application registered one, the default otherwise
	const job = await useQueue().location(contract.queue).enqueue(contract, parsed, effective, id);

	// 4. Listeners get the parsed payload; the emit is fire-and-forget, as every action event is
	useEmitter().emitAction(JOB_ENQUEUED_EVENT, { ...job, payload: parsed });

	return job;
};

/**
 * The public face of the package, for callers who prefer `jobs.enqueue(…)` to a bare function.
 */
export const jobs: { enqueue: typeof enqueue } = { enqueue };
