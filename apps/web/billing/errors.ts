import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Details of an exceeded limit.
 */
export interface LimitExceededErrorExtensions {
	/** What is limited — the entitlement key (`seats`, `projects`). */
	category: string;
}

/**
 * Details of a restricted resource.
 */
export interface ResourceRestrictedErrorExtensions {
	/** What is restricted — the entitlement key (`sso`, `audit_log`). */
	category: string;
}

/**
 * Build the message of a {@link LimitExceededError} from its extensions.
 *
 * @param extensions - The category whose limit would be exceeded.
 * @returns Message naming the category, so the caller knows which limit to raise.
 */
export const limitExceededMessage = (extensions: LimitExceededErrorExtensions): string => {
	// Name the category alone: the numbers live on the check the caller ran, not on the error
	return `Limit exceeded for "${extensions.category}".`;
};

/**
 * Build the message of a {@link ResourceRestrictedError} from its extensions.
 *
 * @param extensions - The category the plan does not grant.
 * @returns Message naming the category, so the caller knows which feature the plan lacks.
 */
export const resourceRestrictedMessage = (extensions: ResourceRestrictedErrorExtensions): string => {
	// Name the category alone: which plan grants it is the pricing page's business, not the error's
	return `Resource "${extensions.category}" is restricted.`;
};

/**
 * Error thrown when an operation would take an organization over what its plan allows: one more seat than the plan
 * has, one more project than the plan grants.
 *
 * Answers with HTTP 403 and carries the category, so a transport layer can point the caller at the plan page. Built
 * with `createError()` of `@novastarter/errors`, so `isNovastarterError(error, 'LIMIT_EXCEEDED')` tells it apart.
 *
 * @example
 * ```ts
 * throw new LimitExceededError({ category: 'seats' });
 * ```
 */
export const LimitExceededError: NovastarterErrorConstructor<LimitExceededErrorExtensions> =
	createError<LimitExceededErrorExtensions>('LIMIT_EXCEEDED', limitExceededMessage, 403);

/**
 * Error thrown when an organization uses a feature its plan does not grant: a switch that is off, such as SSO on a
 * free plan.
 *
 * Answers with HTTP 403 and carries the category, so a transport layer can point the caller at the plan page. Built
 * with `createError()` of `@novastarter/errors`, so `isNovastarterError(error, 'RESOURCE_RESTRICTED')` tells it
 * apart.
 *
 * @example
 * ```ts
 * throw new ResourceRestrictedError({ category: 'sso' });
 * ```
 */
export const ResourceRestrictedError: NovastarterErrorConstructor<ResourceRestrictedErrorExtensions> =
	createError<ResourceRestrictedErrorExtensions>('RESOURCE_RESTRICTED', resourceRestrictedMessage, 403);
