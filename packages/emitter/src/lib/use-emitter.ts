import { type Singleton, singleton } from '@novastarter/utils';
import { Emitter } from './emitter.js';

/**
 * Return the process-wide emitter, building it on first use.
 *
 * @returns The same {@link Emitter} on every call, so a hook registered anywhere fires for events emitted anywhere;
 * `useEmitter.reset()` drops it, for tests.
 *
 * @example
 * ```ts
 * useEmitter().onAction('user.create', ({ key }) => audit(key));
 * ```
 */
export const useEmitter: Singleton<Emitter> = singleton(() => new Emitter());
