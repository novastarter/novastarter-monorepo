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
 * Create an Express middleware that rejects requests while the process is overloaded.
 *
 * One {@link PressureMonitor} is created per middleware instance and shared by every request passing through it.
 * When it reports overload the request is handed to the error handler with `options.error` (or a generic
 * `Error`); otherwise the request continues normally. The monitor is reachable as `handler.monitor`, so an app
 * that is torn down can close it.
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
	options: PressureMonitorOptions & { error?: Error; retryAfter?: string },
): PressureHandler => {
	// 1. Create the monitor once, outside the handler, so its sampling timer is not restarted for each request
	const monitor = new PressureMonitor(options);

	// 2. The handler closes over that single monitor and only reads its cached verdict per request
	const handler: RequestHandler = (_req, res, next) => {
		// 1. Reject only while the latest sample reports overload
		if (monitor.overloaded) {
			// 2. Tell clients when to come back, but only when the caller chose a value
			if (options.retryAfter) {
				res.header('Retry-After', options.retryAfter);
			}

			// 3. Forwarding an error to `next` lets the app's error handler decide the status and body
			return next(options.error ?? new Error('Pressure limit exceeded'));
		}

		// 4. Under normal load the middleware is transparent
		return next();
	};

	// 3. Attaching the monitor to the function is what lets the caller stop it; the handler stays a plain
	//    `RequestHandler` for Express
	return Object.assign(handler, { monitor });
};
