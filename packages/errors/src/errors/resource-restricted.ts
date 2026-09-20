import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Details of a restricted resource.
 */
export interface ResourceRestrictedErrorExtensions {
	/** What is restricted — the entitlement key (`sso`, `audit_log`). */
	category: string;
}

/**
 * Build the message of a {@link ResourceRestrictedError} from its extensions.
 *
 * @param extensions - The category the plan does not grant.
 * @returns Message naming the category, so the caller knows which feature the plan lacks.
 */
export const messageConstructor = (extensions: ResourceRestrictedErrorExtensions): string => {
	// 1. Name the category alone: which plan grants it is the pricing page's business, not the error's
	return `Resource "${extensions.category}" is restricted.`;
};

/**
 * Error thrown when an organization uses a feature its plan does not grant: a switch that is off, such as SSO on a
 * free plan.
 *
 * Answers with HTTP 403 and carries the category, so a transport layer can point the caller at the plan page.
 *
 * @example
 * ```ts
 * throw new ResourceRestrictedError({ category: 'sso' });
 * ```
 */
export const ResourceRestrictedError: NovastarterErrorConstructor<ResourceRestrictedErrorExtensions> =
	createError<ResourceRestrictedErrorExtensions>(ErrorCode.ResourceRestricted, messageConstructor, 403);
