import { DriverManager } from '@novastarter/utils';
import type { QueueDriver } from '../driver.js';
import { QueueDriverBullmq, type QueueDriverBullmqConfig } from './drivers/bullmq.js';
import { QueueDriverLocal, type QueueDriverLocalConfig } from './drivers/local.js';

/**
 * Queue drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/queue' { interface QueueDrivers { sqs: QueueDriverSqsConfig } }` — so a location's
 * `options` are checked against the driver it names.
 */
export interface QueueDrivers {
	/** {@link QueueDriverLocal}: runs the handler in the enqueuing process. */
	local: QueueDriverLocalConfig;
	/** {@link QueueDriverBullmq}: puts the job on Redis for a worker. */
	bullmq: QueueDriverBullmqConfig;
}

/**
 * Name of the location that takes every queue without a location of its own.
 *
 * @defaultValue `default`
 */
export const DEFAULT_QUEUE_LOCATION = 'default';

/**
 * Registry of named queues — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for background jobs. A location is named after a queue — the part of a job
 * name before the dot — so `enqueue('mail.send')` goes to the location `mail`; the one named
 * {@link DEFAULT_QUEUE_LOCATION} takes every queue without a location of its own, since the queue names come from
 * the contracts at runtime and most of them share one server. The built-in drivers (`local`, `bullmq`) are registered
 * on construction, so the application only registers its locations, with the options it read from its own
 * configuration; a driver is built on the location's first use. The application wires it at start-up through
 * {@link useQueue}.
 *
 * @example
 * ```ts
 * const queue = new QueueManager();
 *
 * queue.registerLocation('default', {
 * 	driver: 'local',
 * 	options: {},
 * });
 * queue.registerLocation('mail', {
 * 	driver: 'bullmq',
 * 	options: {
 * 		connection: 'redis://jobs:6379',
 * 		prefix: 'acme',
 * 	},
 * });
 * ```
 */
export class QueueManager extends DriverManager<QueueDriver, QueueDrivers> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', QueueDriverLocal);
		this.registerDriver('bullmq', QueueDriverBullmq);
	}

	/**
	 * Return the driver of a queue: its own location, or the default one.
	 *
	 * @param name - Queue name, the part of a job name before the dot.
	 * @returns The driver bound to that queue, or to {@link DEFAULT_QUEUE_LOCATION} when it has none of its own.
	 * @throws Error when neither the queue's location nor the default one is registered.
	 */
	override location(name: string): QueueDriver {
		// 1. The queue's own location wins; the default one covers every queue nobody registered, which is how a
		//    single-server deployment needs one registration for all of its jobs
		if (this.hasLocation(name)) {
			return super.location(name);
		}

		// 2. Name the queue in the error, not the default location: the reader has to learn which job has nowhere to go
		if (!this.hasLocation(DEFAULT_QUEUE_LOCATION)) {
			throw new Error(`Queue "${name}" has no location of its own and no "${DEFAULT_QUEUE_LOCATION}" one.`);
		}

		return super.location(DEFAULT_QUEUE_LOCATION);
	}

	/**
	 * Close the driver of every location built so far; the process is shutting down.
	 *
	 * @returns Once every driver released its connections and timers.
	 */
	async close(): Promise<void> {
		// 1. Only the drivers built so far have anything to release; they close in parallel — each its own queues
		//    and, for `bullmq`, the client it opened
		await Promise.all([...this.instantiated().values()].map((driver) => driver.close()));
	}
}
