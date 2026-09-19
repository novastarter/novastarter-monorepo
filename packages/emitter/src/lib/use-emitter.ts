import { Emitter } from './emitter.js';

/**
 * Memoized emitter, held at module level so every part of the process shares one set of hooks.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 * @defaultValue Empty until the first {@link useEmitter} call.
 */
export const _cache: {
	emitter: Emitter | undefined;
} = { emitter: undefined };

/**
 * Return the process-wide emitter, building it on first use.
 *
 * @returns The same {@link Emitter} on every call, so a hook registered anywhere fires for events emitted anywhere.
 *
 * @example
 * ```ts
 * useEmitter().onAction('user.create', ({ key }) => audit(key));
 * ```
 */
export const useEmitter = (): Emitter => {
	// 1. Reuse the built emitter — a second instance would split the hooks in two
	if (_cache.emitter) {
		return _cache.emitter;
	}

	// 2. First call in this process builds it and memoizes the result
	_cache.emitter = new Emitter();

	return _cache.emitter;
};
