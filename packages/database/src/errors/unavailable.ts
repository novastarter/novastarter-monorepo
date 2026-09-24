import { createError, type NovastarterError, type NovastarterErrorConstructor } from '@novastarter/errors';
import { toErrorMessage } from '@novastarter/utils';

/**
 * What {@link DatabaseUnavailableError} carries.
 */
export interface DatabaseUnavailableErrorExtensions {
	/** The location's label, when the driver was built by the manager; `undefined` for a driver built by hand. */
	database: string | undefined;
	/** One line from the connection's own error. */
	reason: string;
}

/**
 * The database did not answer: the connection was refused, timed out, or the instance never came up.
 *
 * Thrown by `ping()` of every driver, whichever backend serves the location, so a health check or a bootstrap tells
 * an unreachable database from a failing query with `instanceof` or
 * `isNovastarterError(error, 'DATABASE_UNAVAILABLE')`. The backend's own error stays reachable as `cause`.
 */
export const DatabaseUnavailableError: NovastarterErrorConstructor<DatabaseUnavailableErrorExtensions> =
	createError<DatabaseUnavailableErrorExtensions>(
		'DATABASE_UNAVAILABLE',
		({ database, reason }) =>
			database ? `Database "${database}" is unavailable: ${reason}` : `The database is unavailable: ${reason}`,
		503,
	);

/**
 * Peel Drizzle's query wrapper off an error, so the connection's own error is what remains.
 *
 * Drizzle wraps every failed query in a `DrizzleQueryError` whose message is only the query text
 * (`Failed query: select 1\nparams: `), with the driver's error as its `cause`. The check is duck-typed on that
 * message because this package does not depend on `drizzle-orm`.
 *
 * @param error - Whatever the backend threw or rejected with.
 * @returns The wrapped driver error when `error` is Drizzle's wrapper, otherwise `error` itself.
 * @internal
 */
const unwrapQueryError = (error: unknown): unknown => {
	// Only Drizzle's wrapper carries the query text as its message and the real failure as its cause
	if (error instanceof Error && error.message.startsWith('Failed query:') && error.cause !== undefined) {
		return error.cause;
	}

	// Anything else already is the connection's own error
	return error;
};

/**
 * Describe a connection's error in one line.
 *
 * Node reports a refused connection to a host with several addresses (`localhost` resolves to `::1` and
 * `127.0.0.1`) as an `AggregateError` with an empty message, one inner error per attempted address. Its name alone
 * (`AggregateError`) says nothing, so the inner messages are joined instead, and the `code` stands in when there are
 * none.
 *
 * @param error - The connection's own error, Drizzle's wrapper already peeled off.
 * @returns The line that becomes the reason of a {@link DatabaseUnavailableError}.
 * @internal
 */
const describeError = (error: unknown): string => {
	// An `AggregateError` without a message of its own is described by what failed inside it: every attempted
	// address, or the error code when the list is empty
	if (error instanceof AggregateError && error.message === '') {
		const inner = (error.errors as unknown[]).map((item) => toErrorMessage(item)).join('; ');
		const code: unknown = (error as { code?: unknown }).code;

		if (inner !== '') {
			return inner;
		}

		if (typeof code === 'string' && code !== '') {
			return code;
		}
	}

	return toErrorMessage(error);
};

/**
 * Wrap what a connection raised into a {@link DatabaseUnavailableError}.
 *
 * A Drizzle query wrapper is peeled off first, so the reason names the real failure (refused, auth, DNS) rather
 * than the query text. An `AggregateError` without a message (a refused `localhost`) is described by its inner errors.
 *
 * @param error - Whatever the backend threw or rejected with.
 * @param database - The location's label, when known.
 * @returns The error to throw, the backend's as its `cause`.
 * @example
 * ```ts
 * try {
 * 	await this.db.execute(sql`select 1`);
 * } catch (error) {
 * 	throw toUnavailableError(error, this.label);
 * }
 * ```
 */
export const toUnavailableError = (
	error: unknown,
	database?: string,
): NovastarterError<DatabaseUnavailableErrorExtensions> => {
	// Drizzle's query wrapper carries only the query text as its message, which says nothing of the failure
	const source = unwrapQueryError(error);

	// The reason lets the line read on its own; the cause keeps the backend's code and stack for whoever needs them
	return new DatabaseUnavailableError({ database, reason: describeError(source) }, { cause: source });
};
