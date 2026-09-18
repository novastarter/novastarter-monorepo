/**
 * Node-only entry point of `@novastarter/utils`, published as `@novastarter/utils/node`.
 *
 * Helpers here depend on Node built-ins such as `node:stream`, which is why they live apart from the shared entry
 * point that has to stay usable outside Node.
 */
export * from './is-readable-stream.js';
