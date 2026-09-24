/**
 * Platform-neutral entry point of `@novastarter/utils`.
 *
 * Only helpers with no Node dependency belong here; anything that needs a Node built-in goes into the `./node` entry
 * point instead.
 */
export { defaults } from './defaults.js';
export { DriverManager, mergeCallOptions } from './driver-manager.js';
export type { CallDefaults, Closable, DriverClass, LocationConfig } from './driver-manager.js';
export { formatTitle } from './format-title/index.js';
export { getSimpleHash } from './get-simple-hash.js';
export { hasMethods } from './has-methods.js';
export { isIn } from './is-in.js';
export { confinePath, joinPath } from './join-path.js';
export { DEFAULT_LOCATION, LocationManager } from './location-manager.js';
export { normalizePath } from './normalize-path.js';
export { noproto, parseJSON } from './parse-json.js';
export { DEFAULT_RETRY_OPTIONS, retry } from './retry.js';
export type { RetryOptions } from './retry.js';
export { singleton } from './singleton.js';
export type { Singleton } from './singleton.js';
export { MAX_TIMER_DELAY, sleep } from './sleep.js';
export { toArray } from './to-array.js';
export { toBoolean } from './to-boolean.js';
export { toErrorMessage } from './to-error-message.js';
export { toError } from './to-error.js';
export { toNumber } from './to-number.js';
export { tryParseJSON } from './try-parse-json.js';
export { TimeoutError, withTimeout } from './with-timeout.js';
export type { WithTimeoutOptions } from './with-timeout.js';
