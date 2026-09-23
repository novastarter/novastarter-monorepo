/**
 * Sign-in: the `AuthDriver` contract the `@novastarter/auth-driver-*` packages implement, the identity they return,
 * and the functions that run a sign-in through them.
 */
export * from './driver.js';
export * from './lib/challenge.js';
export { AUTH_SIGN_IN_FAILED_EVENT, AUTH_SIGN_IN_FILTER, AUTH_SIGNED_IN_EVENT } from './lib/events.js';
export * from './lib/oauth.js';
export * from './lib/sign-in.js';
export * from './types.js';
