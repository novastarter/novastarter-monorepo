/**
 * Tests of `pressure/lib/pressure-monitor`.
 */
import type { EventLoopUtilization, IntervalHistogram } from 'node:perf_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PressureMonitorOptions } from './pressure-monitor.js';
import { PressureMonitor } from './pressure-monitor.js';

vi.mock('node:perf_hooks');
vi.mock('node:timers');
vi.mock('node:process');

let monitor: PressureMonitor;
let mockIntervalHistogram: IntervalHistogram;
let mockTimer: NodeJS.Timeout;

let sample: {
	config: Required<PressureMonitorOptions>;
	rss: number;
	heapUsed: number;
	eventLoopUtilization: number;
	meanEventLoopDelay: number;
	previousElu: EventLoopUtilization;
	currentElu: EventLoopUtilization;
};

beforeEach(() => {
	// A full sample: the thresholds under test, plus readings on both sides of them, so a test flips only the field it
	// cares about
	sample = {
		config: {
			sampleInterval: 1000,
			resolution: 15,
			maxMemoryHeapUsed: 500000000,
			maxMemoryRss: 800000000,
			maxEventLoopDelay: 500,
			maxEventLoopUtilization: 0.5,
		},
		rss: 600000000,
		heapUsed: 400000000,
		eventLoopUtilization: 0.3,
		meanEventLoopDelay: 150000000,
		previousElu: { idle: 1000, active: 200, utilization: 0.17 },
		currentElu: { idle: 1200, active: 1000, utilization: 0.45 },
	};

	// The histogram is a stub: its `mean` stands in for the event-loop delay reading
	mockIntervalHistogram = {
		enable: vi.fn(),
		disable: vi.fn(),
		reset: vi.fn(),
		mean: sample.meanEventLoopDelay,
	} as unknown as IntervalHistogram;

	// The timer is a stub too; `refresh` is what the monitor re-arms on every sample, `unref` what keeps it from
	// holding the event loop
	mockTimer = {
		refresh: vi.fn(),
		unref: vi.fn(),
	} as unknown as NodeJS.Timeout;

	// The monitor under test is built only after the stubs, so its constructor wires itself to them
	vi.mocked(setTimeout).mockReturnValue(mockTimer);
	vi.mocked(monitorEventLoopDelay).mockReturnValue(mockIntervalHistogram);

	monitor = new PressureMonitor(sample.config);
});

afterEach(() => {
	// Every mock is rebuilt by the next test's setup, so nothing may carry over
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Defaults the options', () => {
		// With no options every threshold is off: only what the caller sets is enforced
		monitor = new PressureMonitor();

		expect(monitor['options']).toEqual({
			sampleInterval: 250,
			resolution: 10,
			maxMemoryHeapUsed: false,
			maxMemoryRss: false,
			maxEventLoopDelay: false,
			maxEventLoopUtilization: false,
		});
	});

	test('Creates histogram', () => {
		expect(monitorEventLoopDelay).toHaveBeenCalledWith({ resolution: sample.config.resolution });
		expect(monitor['histogram']).toBe(mockIntervalHistogram);
		expect(mockIntervalHistogram.enable).toHaveBeenCalledOnce();
	});

	test('Starts a timeout', () => {
		expect(setTimeout).toHaveBeenCalledOnce();
		expect(setTimeout).toHaveBeenCalledWith(monitor['updateUsage'], sample.config.sampleInterval);
		expect(monitor['timeout']).toBe(mockTimer);
		expect(mockTimer.unref).toHaveBeenCalledOnce();
	});

	test('Takes a base utilization reading so the first sample skips the start-up load', () => {
		// The first delta is measured against a base taken at construction, so the load of booting does not read as
		// pressure
		vi.spyOn(performance, 'eventLoopUtilization').mockReturnValue(sample.previousElu);

		monitor = new PressureMonitor(sample.config);

		expect(performance.eventLoopUtilization).toHaveBeenCalledWith();
		expect(monitor['lastEventLoopUtilization']).toBe(sample.previousElu);
	});
});

describe('#overloaded', () => {
	test('Returns false if all settings are false', () => {
		monitor = new PressureMonitor({
			maxMemoryHeapUsed: false,
			maxMemoryRss: false,
			maxEventLoopDelay: false,
			maxEventLoopUtilization: false,
		});

		expect(monitor.overloaded).toBe(false);
	});

	test('Returns true if mem heap used exceeds threshold', () => {
		monitor['memoryHeapUsed'] = (sample.config.maxMemoryHeapUsed as number) + 1;
		expect(monitor.overloaded).toBe(true);
	});

	test('Returns true if mem rss exceeds threshold', () => {
		monitor['memoryRss'] = (sample.config.maxMemoryRss as number) + 1;
		expect(monitor.overloaded).toBe(true);
	});

	test('Returns true if event loop delay exceeds threshold', () => {
		monitor['eventLoopDelay'] = (sample.config.maxEventLoopDelay as number) + 1;
		expect(monitor.overloaded).toBe(true);
	});

	test('Returns true if event utilization exceeds threshold', () => {
		monitor['eventLoopUtilization'] = (sample.config.maxEventLoopUtilization as number) + 1;
		expect(monitor.overloaded).toBe(true);
	});
});

describe('#updateUsage', () => {
	beforeEach(() => {
		// The two samplers are replaced, so the call is counted without sampling anything
		monitor['updateMemoryUsage'] = vi.fn();
		monitor['updateEventLoopUsage'] = vi.fn();

		monitor['updateUsage']();
	});

	test('Calls updateMemoryUsage', () => {
		expect(monitor['updateMemoryUsage']).toHaveBeenCalledOnce();
	});

	test('Calls updateEventLoopUsage', () => {
		expect(monitor['updateEventLoopUsage']).toHaveBeenCalledOnce();
	});

	test('Refreshes the timer', () => {
		expect(mockTimer.refresh).toHaveBeenCalledOnce();
	});

	test('Neither samples nor re-arms the timer once closed', () => {
		// Only what runs after `close()` may be observed, so the calls the setup already made are cleared
		vi.mocked(mockTimer.refresh).mockClear();
		vi.mocked(monitor['updateMemoryUsage']).mockClear();
		vi.mocked(monitor['updateEventLoopUsage']).mockClear();

		monitor.close();
		monitor['updateUsage']();

		expect(monitor['updateMemoryUsage']).not.toHaveBeenCalled();
		expect(monitor['updateEventLoopUsage']).not.toHaveBeenCalled();
		expect(mockTimer.refresh).not.toHaveBeenCalled();
	});
});

describe('#updateMemoryUsage', () => {
	beforeEach(() => {
		vi.mocked(memoryUsage).mockReturnValue({ rss: sample.rss, heapUsed: sample.heapUsed } as NodeJS.MemoryUsage);
		monitor['updateMemoryUsage']();
	});

	test('Gets heapUsed and rss from memoryUsage', () => {
		expect(memoryUsage).toHaveBeenCalledOnce();
	});

	test('Saves memoryUsage and rss', () => {
		expect(monitor['memoryHeapUsed']).toBe(sample.heapUsed);
		expect(monitor['memoryRss']).toBe(sample.rss);
	});
});

describe('#updateEventLoopUsage', () => {
	beforeEach(() => {
		// The delta is measured against the base of the previous sample: the first spy answer is the current reading,
		// the second the computed utilization of the window between the two
		monitor['lastEventLoopUtilization'] = sample.previousElu;

		vi.spyOn(performance, 'eventLoopUtilization')
			.mockReturnValueOnce(sample.currentElu)
			.mockReturnValueOnce({ idle: 200, active: 800, utilization: sample.eventLoopUtilization });

		monitor['updateEventLoopUsage']();
	});

	test('Sets eventLoopUtilization to the ratio since the previous sample, not since process start', () => {
		// The current reading is taken bare, then applied to the previous base — the ratio of the window, not of the
		// whole process lifetime
		expect(performance.eventLoopUtilization).toHaveBeenCalledTimes(2);
		expect(performance.eventLoopUtilization).toHaveBeenNthCalledWith(1);
		expect(performance.eventLoopUtilization).toHaveBeenNthCalledWith(2, sample.currentElu, sample.previousElu);
		expect(monitor['eventLoopUtilization']).toBe(sample.eventLoopUtilization);
	});

	test('Keeps the latest reading as the base of the next delta', () => {
		expect(monitor['lastEventLoopUtilization']).toBe(sample.currentElu);
	});

	test('Sets eventLoopDelay based on histogram mean', () => {
		expect(monitor['eventLoopDelay']).toBe(Math.round(sample.meanEventLoopDelay / 1e6));
	});

	test('Resets the histogram interval', () => {
		// The interval is zeroed per sample, so each mean covers one window
		expect(mockIntervalHistogram.reset).toHaveBeenCalledOnce();
	});
});

describe('#close', () => {
	beforeEach(() => {
		monitor.close();
	});

	test('Clears the pending sample', () => {
		expect(clearTimeout).toHaveBeenCalledOnce();
		expect(clearTimeout).toHaveBeenCalledWith(mockTimer);
	});

	test('Disables the histogram so its native sampler stops', () => {
		expect(mockIntervalHistogram.disable).toHaveBeenCalledOnce();
	});

	test('Keeps the verdict of the last sample readable', () => {
		// Closing stops the sampling, not the verdict: what was over stays over
		monitor['memoryRss'] = (sample.config.maxMemoryRss as number) + 1;
		expect(monitor.overloaded).toBe(true);
	});

	test('Is harmless when called twice', () => {
		monitor.close();

		expect(clearTimeout).toHaveBeenCalledOnce();
		expect(mockIntervalHistogram.disable).toHaveBeenCalledOnce();
	});
});
