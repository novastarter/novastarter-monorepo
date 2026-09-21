/**
 * Public entry point of `@novastarter/pressure`.
 *
 * Exposes the {@link PressureMonitor} class for standalone use and the {@link handlePressure} Express middleware
 * built on top of it.
 */
export * from './lib/handle-pressure.js';
export * from './lib/pressure-monitor.js';
