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

	mockMonitor = { overloaded: false, close: vi.fn() };
	vi.mocked(PressureMonitor).mockImplementation(() => mockMonitor as unknown as PressureMonitor);

	req = {} as Request;
	res = { header: vi.fn() } as unknown as Response;
	next = vi.fn();
});

afterEach(() => {
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

	test('Forwards the given error when overloaded', () => {
		const handler = handlePressure({ ...sample.options, error: sample.error });
		mockMonitor.overloaded = true;

		handler(req, res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledWith(sample.error);
	});

	test('Sets Retry-After when overloaded and a value is given', () => {
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
		const handler = handlePressure(sample.options);

		mockMonitor.overloaded = true;
		handler(req, res, next);
		mockMonitor.overloaded = false;
		handler(req, res, next);

		expect(next).toHaveBeenNthCalledWith(1, new Error('Pressure limit exceeded'));
		expect(next).toHaveBeenNthCalledWith(2);
	});
});
