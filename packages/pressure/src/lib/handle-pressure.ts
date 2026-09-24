import type { RequestHandler } from 'express';
import type { PressureMonitorOptions } from './pressure-monitor.js';
import { PressureMonitor } from './pressure-monitor.js';

/**
 * Express handler returned by {@link handlePressure}, carrying the monitor it consults.
 *
 * The monitor is exposed so the sampling it runs in the background can be stopped with `monitor.close()` once the
 * app is torn down; without that every handler ever created keeps sampling until the process exits.
 */
export type PressureHandler = RequestHandler & {
	/** The one {@link PressureMonitor} every request through this handler is checked against. */
	monitor: PressureMonitor;
};

/**
 * Copy an error so one request's handling of it cannot affect the next.
 *
 * The copy carries the prototype, the message and every own property of the original — a `code`, typed
 * `extensions`, a `cause` — so an `instanceof` check or a field read answers exactly as it would on the original,
 * while a mutation lands on the copy alone.
 *
 * @param error - Error to copy.
 * @returns The copy, or `undefined` when no error was given.
 */
const cloneError = (error: Error | undefined): Error | undefined => {
	if (error === undefined) return undefined;

	// A fresh object on the original's prototype, with its own properties copied over, is indistinguishable from the
	// original for reading yet writes nothing back to it
	return Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error));
};

/**
 * Create an Express middleware that rejects requests while the process is overloaded.
 *
 * One {@link PressureMonitor} is created per middleware instance and shared by every request passing through it.
 * When it reports overload the request is handed to the error handler with `options.error` (or a generic
 * `Error`); otherwise the request continues normally. The monitor is reachable as `handler.monitor`, so an app
 * that is torn down can close it.
 *
 * The error may be an `Error` or a factory returning one, the pattern {@link withTimeout} of `@novastarter/utils`
 * uses: a factory is called per rejected request, and an `Error` is cloned per request, so an error handler that
 * mutates what it receives leaks nothing into the next overloaded request.
 *
 * @param options - Monitor thresholds plus an optional `error` to forward and a `Retry-After` header value.
 * @returns Express request handler with its monitor attached.
 * @example
 * ```ts
 * const handler = handlePressure({
 * 	maxEventLoopUtilization: 0.8,
 * 	retryAfter: '5',
 * });
 *
 * app.use(handler);
 *
 * server.on('close', () => handler.monitor.close());
 * ```
 */
export const handlePressure = (
	options: PressureMonitorOptions & { error?: Error | (() => Error); retryAfter?: string },
): PressureHandler => {
	// Created once, outside the handler, so its sampling timer is not restarted for each request
	const monitor = new PressureMonitor(options);

	const handler: RequestHandler = (_req, res, next) => {
		if (monitor.overloaded) {
			if (options.retryAfter) {
				res.header('Retry-After', options.retryAfter);
			}

			// Forwarding the error to `next` lets the app's error handler decide the status and body. The error is
			// resolved per request — a factory is called, an `Error` is cloned — so a handler that mutates it cannot
			// share that state with the next overloaded request
			const error = typeof options.error === 'function' ? options.error() : cloneError(options.error);

			return next(error ?? new Error('Pressure limit exceeded'));
		}

		return next();
	};

	// Attaching the monitor to the function is what lets the caller stop it; the handler stays a plain `RequestHandler`
	// for Express
	return Object.assign(handler, { monitor });
};
