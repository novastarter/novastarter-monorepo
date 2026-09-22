/**
 * Public entry point of `@novastarter/auth`.
 *
 * The building blocks of authentication as an API: everything is made, signed, hashed and checked here, and nothing
 * is stored — the application keeps the records these functions hand back, in its own tables, and hands them in again.
 *
 * - `providers`: the `AuthDriver` contract of the `@novastarter/auth-driver-*` packages and `signIn()`,
 *   `startOAuth()`, `finishOAuth()`, on the `AuthManager` of `useAuth()`;
 * - `sessions`, `passwords`, `tokens` (one-time and JWT) and `mfa` (TOTP and recovery codes).
 *
 * The application registers the drivers, the locations and the settings at start-up; the package reads nothing from
 * the environment and knows nothing of the application's users beyond an id.
 */
export * from './errors/index.js';
export * from './lib/auth-manager.js';
export * from './lib/settings.js';
export * from './lib/use-auth.js';
export * from './mfa/index.js';
export * from './passwords/index.js';
export * from './providers/index.js';
export * from './sessions/index.js';
export * from './tokens/index.js';
export * from './types.js';
export { hashToken } from './utils/hash-token.js';
