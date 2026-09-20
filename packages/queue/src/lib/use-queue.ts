import { QueueManager } from './queue-manager.js';

/**
 * The manager of the process.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 */
export const _cache: { queue: QueueManager | undefined } = { queue: undefined };

/**
 * Return the process-wide {@link QueueManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; `enqueue()` and `createWorker()` look their queue up
 * on the same instance afterwards.
 *
 * @returns The same manager on every call.
 * @example
 * ```ts
 * // at start-up
 * useQueue().registerLocation('mail', {
 * 	driver: 'bullmq',
 * 	options: { connection: env['QUEUE_MAIL_REDIS'] as string, prefix: env['QUEUE_MAIL_PREFIX'] as string },
 * });
 *
 * // anywhere later
 * await enqueue('mail.send', payload);
 * ```
 */
export const useQueue = (): QueueManager => {
	// 1. One manager per process: a second one would open a second set of Redis connections
	if (_cache.queue) {
		return _cache.queue;
	}

	_cache.queue = new QueueManager();

	return _cache.queue;
};
