import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Error thrown when credentials do not verify: a wrong password, a signature that does not match its secret.
 *
 * Answers with HTTP 401 and carries no details on purpose — telling the caller which part failed would help an
 * attacker more than a user.
 *
 * @example
 * ```ts
 * if (!verifySignature(body, signature, secret)) {
 *     throw new InvalidCredentialsError();
 * }
 * ```
 */
export const InvalidCredentialsError: NovastarterErrorConstructor = createError(
	ErrorCode.InvalidCredentials,
	'Invalid credentials.',
	401,
);
