/**
 * Public entry point of `@novastarter/errors`.
 *
 * The factory, the code catalogue, the type guard and the ready-made error classes are re-exported from one place,
 * so consumers import everything from a single package path.
 */
export * from './codes.js';
export * from './create-error.js';
export * from './errors/index.js';
export * from './is-novastarter-error.js';
