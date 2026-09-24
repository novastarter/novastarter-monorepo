/**
 * Sessions: opaque tokens whose records the application stores, with a hard and an optional sliding idle lifetime.
 */
export { checkSession, type SessionCheck } from './check-session.js';
export { type CreatedSession, createSession, type CreateSessionOptions } from './create-session.js';
