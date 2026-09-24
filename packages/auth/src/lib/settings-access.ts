import type { AuthSettings } from './settings.js';
import { useAuth } from './use-auth.js';

/**
 * The registered settings, read afresh on every call.
 *
 * @returns The settings of `useAuth()`.
 * @internal
 */
export const authSettings = (): AuthSettings => {
	// Read on every call rather than captured at import, so a later `registerSettings` applies at once
	return useAuth().settings();
};
