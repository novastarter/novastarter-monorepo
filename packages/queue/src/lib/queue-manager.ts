import { DriverManager } from '@novastarter/utils';
import type { QueueProvider } from '../types.js';
import { type BullmqQueueOptions, QueueBullmq } from './providers/bullmq.js';
import { type LocalQueueOptions, QueueLocal } from './providers/local.js';

/**
 * Options of a queue location: those of its driver.
 */
export type QueueLocationOptions = LocalQueueOptions | BullmqQueueOptions;

/**
 * Registry of named queues — locations — and the provider behind each.
 *
 * The {@link DriverManager} of the kit for background jobs. A location is named after a queue — the part of a job
 * name before the dot — so `enqueue('mail.send')` goes to the location `mail`, and one named `default` takes every
 * queue without a location of its own. The built-in drivers (`local`, `bullmq`) are registered on construction, so
 * the application only registers its locations, with the options it read from its own configuration. The
 * application wires it at start-up through {@link useQueue}.
 *
 * @example
 * ```ts
 * const queue = new QueueManager();
 *
 * queue.registerLocation('default', { driver: 'local', options: {} });
 * queue.registerLocation('mail', { driver: 'bullmq', options: { connection: 'redis://jobs:6379', prefix: 'acme' } });
 * ```
 */
export class QueueManager extends DriverManager<QueueProvider, QueueLocationOptions> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', QueueLocal);
		this.registerDriver('bullmq', QueueBullmq);
	}

	/**
	 * Close the provider of every location; the process is shutting down.
	 *
	 * @returns Once every provider released its connections and timers.
	 */
	async close(): Promise<void> {
		// 1. Providers close in parallel: each releases its own queues and, for `bullmq`, the client it opened
		await Promise.all(this.locationNames().map((name) => this.location(name).close()));
	}
}
