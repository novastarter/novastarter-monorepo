import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Details of an exceeded limit.
 */
export interface LimitExceededErrorExtensions {
	/** What is limited — the entitlement key (`seats`, `projects`). */
	category: string;
}

/**
 * Build the message of a {@link LimitExceededError} from its extensions.
 *
 * @param extensions - The category whose limit would be exceeded.
 * @returns Message naming the category, so the caller knows which limit to raise.
 */
export const messageConstructor = (extensions: LimitExceededErrorExtensions): string => {
	// 1. Name the category alone: the numbers live on the check the caller ran, not on the error
	return `Limit exceeded for "${extensions.category}".`;
};

/**
 * Error thrown when an operation would take an organization over what its plan allows: one more seat than the plan
 * has, one more project than the plan grants.
 *
 * Answers with HTTP 403 and carries the category, so a transport layer can point the caller at the plan page.
 *
 * @example
 * ```ts
 * throw new LimitExceededError({ category: 'seats' });
 * ```
 */
export const LimitExceededError: NovastarterErrorConstructor<LimitExceededErrorExtensions> =
	createError<LimitExceededErrorExtensions>(ErrorCode.LimitExceeded, messageConstructor, 403);
