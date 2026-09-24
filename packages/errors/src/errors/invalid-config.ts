import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Details of a rejected configuration.
 */
export interface InvalidConfigErrorExtensions {
	/**
	 * What is wrong and what to do, as a sentence fragment the message is completed with. Name the subject (the
	 * driver, the manager, the location) and the fix: `The mysql database driver needs a "connection"`.
	 */
	reason: string;
}

/**
 * Build the message of an {@link InvalidConfigError} from its extensions.
 *
 * @param extensions - The reason the configuration was rejected.
 * @returns Message naming the reason, so the developer knows what to fix.
 */
export const invalidConfigMessage = (extensions: InvalidConfigErrorExtensions): string => {
	// The reason is a fragment without a full stop, so the message closes it: one sentence, one period
	return `Invalid config. ${extensions.reason}.`;
};

/**
 * Error thrown when a driver, a manager or a location is set up wrong: a missing option, an unknown driver name, a
 * value the driver cannot work with.
 *
 * Answers with HTTP 500: the mistake is in the server's own setup, not in the request, so a client cannot fix it.
 *
 * @example
 * ```ts
 * throw new InvalidConfigError({ reason: 'The mysql database driver needs a "connection"' });
 * ```
 */
export const InvalidConfigError: NovastarterErrorConstructor<InvalidConfigErrorExtensions> =
	createError<InvalidConfigErrorExtensions>(ErrorCode.InvalidConfig, invalidConfigMessage, 500);
