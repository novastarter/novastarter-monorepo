/**
 * Callback invoked with every message published on a channel.
 *
 * It may be async: the bus waits for no handler, but a rejection is logged like a thrown error rather than left as
 * an unhandled rejection.
 *
 * @typeParam T - Payload type the subscriber expects.
 */
export type MessageHandler<T = unknown> = (payload: T) => void | Promise<void>;
