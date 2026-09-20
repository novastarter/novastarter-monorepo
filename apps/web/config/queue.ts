import type { QueueDrivers } from '@novastarter/queue';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * The `default` queue location: where every queue's jobs run.
 *
 * One location takes every queue; a queue that needs a server of its own gets a location registered under its name.
 *
 * @param env - The app's variables.
 * @returns The location to register: BullMQ on the app's Redis when there is one, in-process otherwise.
 */
export const queueConfig = (env: AppEnv): LocationConfig<QueueDrivers> =>
	env.REDIS
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
			};
