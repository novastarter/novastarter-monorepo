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
 * Wrap what a connection raised into a {@link DatabaseUnavailableError}.
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
	// 1. The backend's message becomes the reason, so the line reads on its own; the backend's error stays as `cause`
	//    for whoever needs its code or its stack
	return new DatabaseUnavailableError({ database, reason: toErrorMessage(error) }, { cause: error });
};
