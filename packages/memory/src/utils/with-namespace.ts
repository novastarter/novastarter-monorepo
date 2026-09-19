/**
 * Prefix a key with a namespace, separated by `:`.
 *
 * Every Redis-backed class prefixes its keys and channels this way, so several subsystems (or several deployments)
 * can share one Redis instance without stepping on each other, and `clear` can select its own keys with `namespace:*`.
 *
 * @param key - Key or channel name.
 * @param namespace - Prefix identifying the owner of the key.
 * @returns `namespace:key`.
 */
export const withNamespace = (key: string, namespace: string): string => {
	// 1. `:` is the conventional Redis separator, which keeps the keys readable in Redis tooling
	return `${namespace}:${key}`;
};
