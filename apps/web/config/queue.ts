import type { QueueDrivers } from '@novastarter/queue';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * Queue locations by name: where each queue's jobs run.
 *
 * One `default` location takes every queue; a queue that needs a server of its own gets an entry under its name.
 *
 * @param env - The app's variables.
 * @returns The locations to register: BullMQ on the app's Redis when there is one, in-process otherwise.
 */
export const queueConfig = (env: AppEnv): Record<string, LocationConfig<QueueDrivers>> => ({
	default: env.REDIS
		? {
				driver: 'bullmq',
				options: {
					connection: env.REDIS,
					prefix: env.QUEUE_PREFIX,
				},
			}
		: {
				driver: 'local',
				options: {},
			},
});
