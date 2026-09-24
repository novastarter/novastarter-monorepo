/**
 * What a hook learns about the actor behind an event.
 *
 * Only `accountability` is fixed: `null` when the event has no actor, otherwise whatever the application records
 * about the acting user. Everything else — a database handle, a schema — is attached by the emitting code, so this
 * package stays free of database and schema types.
 */
export type EventContext = {
	/** Who is acting, or `null` for an anonymous or system-triggered event. */
	accountability: Record<string, unknown> | null;
	/** Anything the emitting code attaches for its handlers, for example a database handle. */
	[key: string]: unknown;
};

/**
 * Handler of a filter event, run before an operation and allowed to replace its payload.
 *
 * Filters run one after another, each receiving the payload as the previous one left it. Returning `undefined`
 * leaves the payload untouched, so a handler that only inspects it need not return anything.
 *
 * @typeParam T - Payload the event carries.
 * @param payload - Value of the operation as it stands after the previous filters.
 * @param meta - Details of the operation; always holds the `event` name.
 * @param context - Who is acting and what the emitting code attached.
 * @returns The payload to hand to the next filter, or `undefined` to keep it as is.
 */
export type FilterHandler<T = unknown> = (
	payload: T,
	meta: Record<string, unknown>,
	context: EventContext,
) => T | undefined | Promise<T | undefined>;

/**
 * Handler of an action event, run after an operation without the operation waiting for it.
 *
 * A rejected or throwing action is logged by the emitter and never affects the operation that emitted it.
 *
 * @param meta - Details of the operation; always holds the `event` name.
 * @param context - Who acted and what the emitting code attached.
 */
export type ActionHandler = (meta: Record<string, unknown>, context: EventContext) => void | Promise<void>;

/**
 * Handler of an init event, run at a stage of the application start-up.
 *
 * The emitter waits for it, so a hook may register routes or jobs before the next stage begins; a failure is logged
 * rather than thrown, so one broken hook cannot stop the application.
 *
 * @param meta - What the stage exposes to the hooks; always holds the `event` name.
 */
export type InitHandler = (meta: Record<string, unknown>) => void | Promise<void>;
