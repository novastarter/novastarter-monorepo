import type { RequestHandler } from 'express';
import type { PressureMonitorOptions } from './monitor.js';
import { PressureMonitor } from './monitor.js';

/**
 * Create an Express middleware that rejects requests while the process is overloaded.
 *
 * One {@link PressureMonitor} is created per middleware instance and shared by every request passing through it.
 * When it reports overload the request is handed to the error handler with `options.error` (or a generic
 * `Error`); otherwise the request continues normally.
 *
 * @param options - Monitor thresholds plus an optional `error` to forward and a `Retry-After` header value.
 * @returns Express request handler.
 * @example
 * ```ts
 * app.use(
 * 	handlePressure({
 * 		maxEventLoopUtilization: 0.8,
 * 		retryAfter: '5',
 * 	}),
 * );
 * ```
 */
export const handlePressure = (
	options: PressureMonitorOptions & { error?: Error; retryAfter?: string },
): RequestHandler => {
	// 1. Create the monitor once, outside the handler, so its sampling timer is not restarted for each request
	const monitor = new PressureMonitor(options);

	// 2. The handler closes over that single monitor and only reads its cached verdict per request
	return (_req, res, next) => {
		// 1. Reject only while the latest sample reports overload
		if (monitor.overloaded) {
			// 2. Tell clients when to come back, but only when the caller chose a value
			if (options.retryAfter) {
				res.header('Retry-After', options.retryAfter);
			}

			// 3. Forwarding an error to `next` lets the app's error handler decide the status and body
			return next(options?.error ?? new Error('Pressure limit exceeded'));
		}

		// 4. Under normal load the middleware is transparent
		return next();
	};
};
