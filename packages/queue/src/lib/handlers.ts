import type { JobContract, JobHandler, JobHandlers, JobName } from '../types.js';

/**
 * Registered handlers by job name.
 *
 * Exported as a bare map so tests can reset it in place.
 *
 * @internal
 */
export const _handlers: Map<string, JobHandler> = new Map();

/**
 * Register the handlers of one or more jobs — what a module of the web app does at startup.
 *
 * @param handlers - Handlers keyed by job name.
 * @throws Error when a job already has a handler: two modules claiming one job is a bug.
 *
 * @example
 * ```ts
 * registerJobHandlers({
 * 	'mail.send': async (payload) => sendMail(payload),
 * });
 * ```
 */
export const registerJobHandlers = (handlers: JobHandlers): void => {
	for (const [name, handler] of Object.entries(handlers) as [JobName, JobHandler][]) {
		// 1. A second handler for one job is refused rather than replacing the first: silently overriding would let
		//    two modules each believe they own the job, and only the loader order would decide which runs
		if (_handlers.has(name)) {
			throw new Error(`Job "${name}" already has a handler`);
		}

		// 2. Kept by name, which is what `getJobHandler` looks up from the contract
		_handlers.set(name, handler);
	}
};

/**
 * Look the handler of a job up.
 *
 * @param contract - The job's contract.
 * @returns The handler, or `undefined` when no module registered one.
 */
export const getJobHandler = (contract: JobContract): JobHandler | undefined => _handlers.get(contract.name);
