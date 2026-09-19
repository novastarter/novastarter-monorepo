/**
 * Public entry point of `@novastarter/stores`.
 *
 * Each store lives in its own module and is re-exported here, so consumers import from one package path while the
 * stores stay grouped by the part of the app they describe.
 */
export { type AppState, useAppStore } from './app.js';
