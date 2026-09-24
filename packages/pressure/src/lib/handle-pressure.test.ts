/**
 * Tests of `pressure/lib/handle-pressure` with the monitor of `pressure/lib/pressure-monitor` mocked.
 */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { handlePressure } from './handle-pressure.js';
import { PressureMonitor } from './pressure-monitor.js';

vi.mock('./pressure-monitor.js');

/**
 * Stand-in for the monitor: `overloaded` is a plain field, so a test flips the verdict without sampling anything.
 */
let mockMonitor: { overloaded: boolean; close: ReturnType<typeof vi.fn> };

let req: Request;
let res: Response;
let next: NextFunction;

let sample: {
	options: Parameters<typeof handlePressure>[0];
	error: Error;
};

beforeEach(() => {
	sample = {
		options: { maxEventLoopUtilization: 0.8, maxMemoryRss: 800000000, retryAfter: '5' },
		error: new Error('Custom pressure error'),
	};

	// The monitor is replaced by the stand-in, so a test flips its verdict by hand
	mockMonitor = { overloaded: false, close: vi.fn() };
	vi.mocked(PressureMonitor).mockImplementation(() => mockMonitor as unknown as PressureMonitor);

	// The request and response are bare stubs; only the header call matters to the middleware
	req = {} as Request;
	res = { header: vi.fn() } as unknown as Response;
	next = vi.fn();
});

afterEach(() => {
	// Mocks are rebuilt by the next test's setup, so nothing may carry over
	vi.resetAllMocks();
});

describe('handlePressure', () => {
	test('Creates one monitor per middleware instance with the given options', () => {
		const handler = handlePressure(sample.options);

		expect(PressureMonitor).toHaveBeenCalledOnce();
		expect(PressureMonitor).toHaveBeenCalledWith(sample.options);
		expect(handler.monitor).toBe(mockMonitor);
	});

	test('Does not create a monitor per request', () => {
		const handler = handlePressure(sample.options);

		handler(req, res, next);
		handler(req, res, next);

		expect(PressureMonitor).toHaveBeenCalledOnce();
	});

	test('Exposes the monitor so the caller can close it', () => {
		const handler = handlePressure(sample.options);

		handler.monitor.close();

		expect(mockMonitor.close).toHaveBeenCalledOnce();
	});

	test('Passes the request through without an error when not overloaded', () => {
		const handler = handlePressure(sample.options);

		handler(req, res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledWith();
		expect(res.header).not.toHaveBeenCalled();
	});

	test('Forwards the default error when overloaded', () => {
		const handler = handlePressure({ maxEventLoopUtilization: 0.8 });
		mockMonitor.overloaded = true;

		handler(req, res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledWith(new Error('Pressure limit exceeded'));
	});

	test('Forwards a copy of the given error when overloaded', () => {
		// The forwarded error reads exactly like the one given, but is not the same object: a mutation an error handler
		// makes must not write back into the option
		const handler = handlePressure({ ...sample.options, error: sample.error });
		mockMonitor.overloaded = true;

		handler(req, res, next);

		expect(next).toHaveBeenCalledOnce();

		const forwarded = vi.mocked(next).mock.calls[0]![0] as unknown as Error;

		expect(forwarded).not.toBe(sample.error);
		expect(forwarded).toBeInstanceOf(Error);
		expect(forwarded.message).toBe(sample.error.message);
	});

	test('Hands each overloaded request its own error, so a mutating error handler leaks nothing', () => {
		// An error handler that marks the error it receives; the mark must not survive onto the error of the next
		// overloaded request
		const handler = handlePressure({ ...sample.options, error: sample.error });
		mockMonitor.overloaded = true;

		handler(req, res, (error) => {
			if (error) Object.assign(error, { handled: true });
		});

		handler(req, res, next);

		const forwarded = vi.mocked(next).mock.calls[0]![0] as unknown as Error & { handled?: boolean };

		expect(forwarded).not.toBe(sample.error);
		expect(forwarded.handled).not.toBe(true);
	});

	test('Calls a given error factory per rejected request', () => {
		// The factory pattern `withTimeout` of `@novastarter/utils` uses: every rejected request gets the error freshly
		// built, so nothing is shared between requests by construction
		const factory = vi.fn(() => new Error('factory pressure error'));
		const handler = handlePressure({ ...sample.options, error: factory });
		mockMonitor.overloaded = true;

		handler(req, res, next);
		handler(req, res, next);

		expect(factory).toHaveBeenCalledTimes(2);
		expect(next).toHaveBeenCalledTimes(2);
		expect(vi.mocked(next).mock.calls[0]![0]).not.toBe(vi.mocked(next).mock.calls[1]![0]);
		expect(vi.mocked(next).mock.calls[0]![0]).toEqual(expect.objectContaining({ message: 'factory pressure error' }));
	});

	test('Sets Retry-After when overloaded and a value is given', () => {
		// The header is how a rejected client learns when to come back
		const handler = handlePressure(sample.options);
		mockMonitor.overloaded = true;

		handler(req, res, next);

		expect(res.header).toHaveBeenCalledOnce();
		expect(res.header).toHaveBeenCalledWith('Retry-After', sample.options.retryAfter);
	});

	test('Omits Retry-After when overloaded without a value', () => {
		const handler = handlePressure({ maxEventLoopUtilization: 0.8 });
		mockMonitor.overloaded = true;

		handler(req, res, next);

		expect(res.header).not.toHaveBeenCalled();
	});

	test('Reads the verdict per request, so recovery lets requests through again', () => {
		// Recovery between two requests lets the second one through: the verdict is read per request, not cached
		const handler = handlePressure(sample.options);

		mockMonitor.overloaded = true;
		handler(req, res, next);
		mockMonitor.overloaded = false;
		handler(req, res, next);

		expect(next).toHaveBeenNthCalledWith(1, new Error('Pressure limit exceeded'));
		expect(next).toHaveBeenNthCalledWith(2);
	});
});
