/**
 * Public entry point of `@novastarter/emitter`.
 *
 * One process-wide event bus (`useEmitter`) with three channels — filters that may replace a payload before an
 * operation, fire-and-forget actions after it, and init stages of the application start-up — plus the `Emitter`
 * class itself for code that needs an isolated instance, such as tests.
 */
export * from './lib/emitter.js';
export * from './lib/use-emitter.js';
