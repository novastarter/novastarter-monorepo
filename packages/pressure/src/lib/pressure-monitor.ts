import type { IntervalHistogram } from 'node:perf_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { setTimeout } from 'node:timers';
import { defaults } from '@novastarter/utils';

/**
 * Thresholds and sampling settings for {@link PressureMonitor}.
 *
 * Every threshold defaults to `false`, which disables that check entirely; only the limits a caller sets are
 * enforced.
 */
export type PressureMonitorOptions = {
	/** Largest tolerated mean event loop delay in milliseconds, or `false` to ignore delay. */
	maxEventLoopDelay?: number | false;
	/** Largest tolerated event loop utilization, a ratio between `0` and `1`, or `false` to ignore utilization. */
	maxEventLoopUtilization?: number | false;
	/** Largest tolerated V8 heap usage in bytes, or `false` to ignore heap usage. */
	maxMemoryHeapUsed?: number | false;
	/** Largest tolerated resident set size in bytes, or `false` to ignore RSS. */
	maxMemoryRss?: number | false;
	/** Milliseconds between two samples of the metrics above. */
	sampleInterval?: number;
	/** Sampling rate of the event loop delay histogram in milliseconds. */
	resolution?: number;
};

/**
 * Samples event loop and memory metrics in the background and reports whether the process is overloaded.
 *
 * Metrics are refreshed on a timer, so reading {@link PressureMonitor.overloaded} is a cheap comparison against the
 * last sample rather than a live measurement. The timer is unref'd and therefore never keeps the process alive on
 * its own.
 *
 * @example
 * ```ts
 * const monitor = new PressureMonitor({ maxEventLoopUtilization: 0.8 });
 *
 * if (monitor.overloaded) {
 * 	throw new Error('Pressure limit exceeded');
 * }
 * ```
 */
export class PressureMonitor {
	/**
	 * V8 heap usage in bytes from the latest sample.
	 *
	 * @internal
	 */
	private memoryHeapUsed = 0;

	/**
	 * Resident set size in bytes from the latest sample.
	 *
	 * @internal
	 */
	private memoryRss = 0;

	/**
	 * Mean event loop delay in milliseconds from the latest sample.
	 *
	 * @internal
	 */
	private eventLoopDelay = 0;

	/**
	 * Event loop utilization ratio from the latest sample.
	 *
	 * @internal
	 */
	private eventLoopUtilization = 0;

	/**
	 * Caller options with every missing key filled in from the defaults.
	 *
	 * @internal
	 */
	private options: Required<PressureMonitorOptions>;

	/**
	 * Node histogram that accumulates event loop delay between two samples.
	 *
	 * @internal
	 */
	private histogram: IntervalHistogram;

	/**
	 * Timer driving the sampling; refreshed after every sample instead of being recreated.
	 *
	 * @internal
	 */
	private timeout: NodeJS.Timeout;

	/**
	 * Start sampling right away using the given thresholds.
	 *
	 * @param options - Thresholds and sampling settings; see {@link PressureMonitorOptions} for the defaults.
	 */
	constructor(options: PressureMonitorOptions = {}) {
		// 1. Fill in the defaults so every later comparison can read the options without null checks
		this.options = defaults(options, {
			sampleInterval: 250,
			resolution: 10,
			maxMemoryHeapUsed: false,
			maxMemoryRss: false,
			maxEventLoopDelay: false,
			maxEventLoopUtilization: false,
		});

		// 2. Delay is measured by Node itself between samples; the histogram must be enabled explicitly to record
		this.histogram = monitorEventLoopDelay({ resolution: this.options.resolution });
		this.histogram.enable();

		// 3. Bind once, so the same function reference can be handed to the timer and later refreshed
		this.updateUsage = this.updateUsage.bind(this);
		this.timeout = setTimeout(this.updateUsage, this.options.sampleInterval);

		// 4. A monitor must never keep an otherwise finished process alive
		this.timeout.unref();
	}

	/**
	 * Whether any enabled threshold was exceeded by the latest sample.
	 *
	 * @returns `true` as soon as one limit is crossed, `false` when every enabled metric is within bounds.
	 */
	get overloaded(): boolean {
		// 1. Heap check; a `false` threshold short-circuits, so an unset limit never triggers an overload
		if (this.options.maxMemoryHeapUsed && this.memoryHeapUsed > this.options.maxMemoryHeapUsed) {
			return true;
		}

		// 2. RSS check, same skip rule
		if (this.options.maxMemoryRss && this.memoryRss > this.options.maxMemoryRss) {
			return true;
		}

		// 3. Event loop delay check, same skip rule
		if (this.options.maxEventLoopDelay && this.eventLoopDelay > this.options.maxEventLoopDelay) {
			return true;
		}

		// 4. Event loop utilization check, same skip rule
		if (this.options.maxEventLoopUtilization && this.eventLoopUtilization > this.options.maxEventLoopUtilization) {
			return true;
		}

		// 5. Nothing crossed its limit
		return false;
	}

	/**
	 * Take a fresh sample of every metric and schedule the next one.
	 *
	 * @internal
	 */
	private updateUsage() {
		// 1. Sample memory and event loop metrics together, so `overloaded` compares values from the same instant
		this.updateMemoryUsage();
		this.updateEventLoopUsage();

		// 2. Refreshing the existing timer avoids allocating a new one per sample and keeps the `unref` in place
		this.timeout.refresh();
	}

	/**
	 * Store the current heap usage and resident set size.
	 *
	 * @internal
	 */
	private updateMemoryUsage() {
		// 1. A single `memoryUsage()` call reports both values; only heap and RSS are compared against thresholds
		const { heapUsed, rss } = memoryUsage();
		this.memoryHeapUsed = heapUsed;
		this.memoryRss = rss;
	}

	/**
	 * Store the current event loop utilization and mean delay, then reset the delay histogram.
	 *
	 * @internal
	 */
	private updateEventLoopUsage() {
		// 1. Utilization is a ratio Node computes since the previous call, so no conversion is needed
		this.eventLoopUtilization = performance.eventLoopUtilization().utilization;

		// 2. The histogram reports nanoseconds; thresholds are in milliseconds, hence the 1e6 division
		this.eventLoopDelay = Math.round(this.histogram.mean / 1e6);

		// 3. Reset so the next sample only covers the next interval rather than the whole lifetime
		this.histogram.reset();
	}
}
