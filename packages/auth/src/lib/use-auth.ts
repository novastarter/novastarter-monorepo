import { type Singleton, singleton } from '@novastarter/utils';
import { AuthManager } from './auth-manager.js';

/**
 * Return the process-wide {@link AuthManager}, creating an empty one on first use.
 *
 * The application registers its sign-in drivers, locations and settings on it at start-up; `startOAuth()`,
 * `signIn()` and the session, token and TOTP functions read the same instance afterwards.
 *
 * @returns The same manager on every call; `useAuth.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const auth = useAuth();
 *
 * auth.registerDriver('google', AuthDriverGoogle);
 * auth.registerLocation('google', {
 * 	driver: 'google',
 * 	options: {
 * 		clientId: env.AUTH_GOOGLE_CLIENT_ID,
 * 		clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
 * 	},
 * });
 *
 * // anywhere later
 * const { url } = await startOAuth('google', { redirectUri: 'https://app.example/auth/google/callback' });
 * ```
 */
export const useAuth: Singleton<AuthManager> = singleton(() => new AuthManager());
