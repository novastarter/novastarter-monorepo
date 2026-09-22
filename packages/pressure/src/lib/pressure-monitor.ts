import type { EventLoopUtilization, IntervalHistogram } from 'node:perf_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { defaults } from '@novastarter/utils';

/**
 * Thresholds and sampling settings for {@link PressureMonitor}.
 *
 * Every threshold defaults to `false`, which disables that check entirely; only the limits a caller sets are
 * enforced.
 */
export type PressureMonitorOptions = {
	/**
	 * Largest tolerated mean event loop delay in milliseconds, or `false` to ignore delay.
	 *
	 * @defaultValue `false`
	 */
	maxEventLoopDelay?: number | false;
	/**
	 * Largest tolerated event loop utilization, a ratio between `0` and `1`, or `false` to ignore utilization.
	 *
	 * The ratio covers the interval between two samples, not the whole process lifetime, so a spike after a long
	 * quiet period crosses the limit within one `sampleInterval`.
	 *
	 * @defaultValue `false`
	 */
	maxEventLoopUtilization?: number | false;
	/**
	 * Largest tolerated V8 heap usage in bytes, or `false` to ignore heap usage.
	 *
	 * @defaultValue `false`
	 */
	maxMemoryHeapUsed?: number | false;
	/**
	 * Largest tolerated resident set size in bytes, or `false` to ignore RSS.
	 *
	 * @defaultValue `false`
	 */
	maxMemoryRss?: number | false;
	/**
	 * Milliseconds between two samples of the metrics above.
	 *
	 * @defaultValue `250`
	 */
	sampleInterval?: number;
	/**
	 * Sampling rate of the event loop delay histogram in milliseconds.
	 *
	 * @defaultValue `10`
	 */
	resolution?: number;
};

/**
 * Samples event loop and memory metrics in the background and reports whether the process is overloaded.
 *
 * Metrics are refreshed on a timer, so reading {@link PressureMonitor.overloaded} is a cheap comparison against the
 * last sample rather than a live measurement. The timer is unref'd and therefore never keeps the process alive on
 * its own, but the delay histogram keeps sampling until {@link PressureMonitor.close} is called; a monitor that is
 * created and dropped repeatedly, as in a test suite or under hot reload, has to be closed.
 *
 * @example
 * ```ts
 * const monitor = new PressureMonitor({ maxEventLoopUtilization: 0.8 });
 *
 * if (monitor.overloaded) {
 * 	throw new Error('Pressure limit exceeded');
 * }
 *
 * monitor.close();
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
	 * Event loop utilization ratio over the interval between the two latest samples.
	 *
	 * @internal
	 */
	private eventLoopUtilization = 0;

	/**
	 * Cumulative utilization reading taken at the previous sample; the base the next delta is computed against.
	 *
	 * @internal
	 */
	private lastEventLoopUtilization: EventLoopUtilization;

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
	 * Whether {@link PressureMonitor.close} ran; a closed monitor never re-arms its timer.
	 *
	 * @internal
	 */
	private closed = false;

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

		// 3. Node reports utilization accumulated since the loop started; taking a base reading now lets the first
		//    sample cover only its own interval instead of the whole start-up
		this.lastEventLoopUtilization = performance.eventLoopUtilization();

		// 4. Bind once, so the same function reference can be handed to the timer and later refreshed
		this.updateUsage = this.updateUsage.bind(this);
		this.timeout = setTimeout(this.updateUsage, this.options.sampleInterval);

		// 5. A monitor must never keep an otherwise finished process alive
		this.timeout.unref();
	}

	/**
	 * Whether any enabled threshold was exceeded by the latest sample.
	 *
	 * After {@link PressureMonitor.close} the verdict of the last sample taken stays readable but is never updated.
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
	 * Stop sampling and release the delay histogram.
	 *
	 * The unref'd timer alone would not keep the process alive, but the histogram's native sampler and the re-armed
	 * timer keep doing work for as long as the process runs; closing is what stops them. Closing twice is harmless.
	 */
	close(): void {
		// 1. A second close has nothing left to release
		if (this.closed) {
			return;
		}

		// 2. Flag first, so a sample that is somehow still invoked afterwards does not re-arm the timer
		this.closed = true;

		// 3. Drop the pending sample and stop the native sampler behind the histogram
		clearTimeout(this.timeout);
		this.histogram.disable();
	}

	/**
	 * Take a fresh sample of every metric and schedule the next one.
	 *
	 * @internal
	 */
	private updateUsage(): void {
		// 1. A closed monitor has a disabled histogram and no timer to re-arm; the stale sample stays as it is
		if (this.closed) {
			return;
		}

		// 2. Sample memory and event loop metrics together, so `overloaded` compares values from the same instant
		this.updateMemoryUsage();
		this.updateEventLoopUsage();

		// 3. Refreshing the existing timer avoids allocating a new one per sample and keeps the `unref` in place
		this.timeout.refresh();
	}

	/**
	 * Store the current heap usage and resident set size.
	 *
	 * @internal
	 */
	private updateMemoryUsage(): void {
		// 1. A single `memoryUsage()` call reports both values; only heap and RSS are compared against thresholds
		const { heapUsed, rss } = memoryUsage();
		this.memoryHeapUsed = heapUsed;
		this.memoryRss = rss;
	}

	/**
	 * Store the event loop utilization since the previous sample and the mean delay, then reset the delay histogram.
	 *
	 * @internal
	 */
	private updateEventLoopUsage(): void {
		// 1. A bare `eventLoopUtilization()` is cumulative since the loop started and would flatten every spike into a
		//    lifetime average; passing the previous reading makes Node return the ratio over the last interval only
		const current = performance.eventLoopUtilization();
		this.eventLoopUtilization = performance.eventLoopUtilization(current, this.lastEventLoopUtilization).utilization;
		this.lastEventLoopUtilization = current;

		// 2. The histogram reports nanoseconds; thresholds are in milliseconds, hence the 1e6 division
		this.eventLoopDelay = Math.round(this.histogram.mean / 1e6);

		// 3. Reset so the next sample only covers the next interval rather than the whole lifetime
		this.histogram.reset();
	}
}
