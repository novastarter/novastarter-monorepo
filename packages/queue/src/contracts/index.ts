import type { JobContract, JobName } from '../types.js';

/**
 * Registered contracts by name.
 *
 * Exported as a bare map rather than through accessors only, so tests can reset it in place.
 *
 * @internal
 */
export const _contracts: Map<string, JobContract> = new Map();

/**
 * Add a contract to the registry, where `enqueue()` and the worker look it up.
 *
 * @typeParam Contract - The contract.
 * @param contract - Contract to add.
 * @returns The same contract, so a module can `export const x = registerJob(defineJob(…))`.
 * @throws Error when a contract of that name is registered already — two modules claiming one name is a bug.
 */
export const registerJob = <Contract extends JobContract>(contract: Contract): Contract => {
	if (_contracts.has(contract.name)) {
		throw new Error(`Job "${contract.name}" is already registered`);
	}

	_contracts.set(contract.name, contract);

	return contract;
};

/**
 * Look a contract up by name.
 *
 * @param name - Job name.
 * @returns The contract.
 * @throws Error for a name nobody registered.
 */
export const getJobContract = (name: string): JobContract => {
	const contract = _contracts.get(name);

	if (!contract) {
		throw new Error(`Job "${name}" is not registered`);
	}

	return contract;
};

/**
 * Names of every registered job.
 *
 * @returns The names, in registration order.
 */
export const getJobNames = (): JobName[] => [..._contracts.keys()] as JobName[];

/**
 * Queues the registered jobs go to — what a worker has to listen on.
 *
 * @returns Distinct queue names, in first-seen order.
 */
export const getQueueNames = (): string[] => [...new Set([..._contracts.values()].map((contract) => contract.queue))];
