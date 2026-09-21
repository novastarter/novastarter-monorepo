import { type Singleton, singleton } from '@novastarter/utils';
import { QueueManager } from './queue-manager.js';

/**
 * Return the process-wide {@link QueueManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; `enqueue()` and `createWorker()` look their queue up
 * on the same instance afterwards.
 *
 * @returns The same manager on every call; `useQueue.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * useQueue().registerLocation('mail', {
 * 	driver: 'bullmq',
 * 	options: {
 * 	connection: env['QUEUE_MAIL_REDIS'] as string,
 * 	prefix: env['QUEUE_MAIL_PREFIX'] as string,
 * },
 * });
 *
 * // anywhere later
 * await enqueue('mail.send', payload);
 * ```
 */
export const useQueue: Singleton<QueueManager> = singleton(() => new QueueManager());
