import type { FeatureFlagContext, FeatureFlagDefinition } from '../types.js';
import { isInRollout } from './percentage.js';

/**
 * Whether a flag is on for a context.
 *
 * The master switch first: a disabled flag is off for everyone, whatever its rules. Then the rules, any of which lets
 * the caller in: the user is listed, the organization is listed, or the subject — the user, else the organization —
 * falls within the rollout percentage. A flag with no rules is on for everyone; a flag whose rules name nobody the
 * caller is (an anonymous caller against a list of users, say) is off.
 *
 * @param definition - The flag.
 * @param context - Who is asking.
 * @returns `true` when the feature is on for the caller.
 * @example
 * ```ts
 * evaluateFeatureFlag({ key: 'new-billing', enabled: true, rules: { percentage: 10 } }, { user: 'u1' });
 * ```
 */
export const evaluateFeatureFlag = (definition: FeatureFlagDefinition, context: FeatureFlagContext): boolean => {
	// The switch overrides everything, so switching a flag off is always a way back
	if (!definition.enabled) {
		return false;
	}

	// No rules, or rules that name nothing, let everyone in, since an empty rule set restricts nobody
	const rules = definition.rules;

	if (!rules || (!rules.users?.length && !rules.organizations?.length && rules.percentage === undefined)) {
		return true;
	}

	// An explicit list beats the rollout, so a named tester always sees the feature
	if (context.user && rules.users?.includes(context.user)) {
		return true;
	}

	if (context.organization && rules.organizations?.includes(context.organization)) {
		return true;
	}

	// The rollout goes by the user first, so a person keeps the feature across organizations, and by the organization
	// otherwise
	const subject = context.user || context.organization;

	if (rules.percentage !== undefined && subject) {
		return isInRollout(definition.key, subject, rules.percentage);
	}

	return false;
};
