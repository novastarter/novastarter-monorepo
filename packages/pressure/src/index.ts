/**
 * Public entry point of `@novastarter/pressure`.
 *
 * Exposes the {@link PressureMonitor} class for standalone use and the {@link handlePressure} Express middleware
 * built on top of it.
 */
export { handlePressure } from './lib/handle-pressure.js';
export type { PressureHandler } from './lib/handle-pressure.js';
export { PressureMonitor } from './lib/pressure-monitor.js';
export type { PressureMonitorOptions } from './lib/pressure-monitor.js';
