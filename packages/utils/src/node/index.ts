/**
 * Node-only entry point of `@novastarter/utils`, published as `@novastarter/utils/node`.
 *
 * Helpers here depend on Node built-ins such as `node:stream`, which is why they live apart from the shared entry
 * point that has to stay usable outside Node. The re-exports are named rather than `export *` on purpose: the
 * memo of {@link processId} stays private to its module, where the tests reset it.
 */
export { isReadableStream } from './is-readable-stream.js';
export { processId } from './process-id.js';
export { requireYaml } from './require-yaml.js';
