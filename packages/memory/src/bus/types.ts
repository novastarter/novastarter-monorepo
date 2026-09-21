/**
 * Callback invoked with every message published on a channel.
 *
 * @typeParam T - Payload type the subscriber expects.
 */
export type MessageHandler<T = unknown> = (payload: T) => void;
