import { useLogger } from '@novastarter/logger';
import type { ActionHandler, EventContext, FilterHandler, InitHandler } from '@novastarter/types';
import { toError } from '@novastarter/utils';
import ee2 from 'eventemitter2';

/**
 * Three-channel event bus that lets code outside a module hook into what the module does.
 *
 * - **Filters** run one after another before an operation and may replace its payload.
 * - **Actions** run after an operation, fire-and-forget; a failing action is logged and never breaks the operation.
 * - **Init** events mark stages of the application start-up, so a hook can register routes or jobs at the right moment.
 *
 * Event names are dotted and wildcards are supported (`items.*.create`), which is what makes a single subscription
 * cover a whole family of events.
 *
 * @example
 * ```ts
 * const emitter = useEmitter();
 *
 * emitter.onFilter('user.create', (payload) => ({ ...payload, source: 'api' }));
 * emitter.onAction('user.create', ({ key }) => audit(key));
 *
 * const payload = await emitter.emitFilter('user.create', input, { collection: 'users' });
 * emitter.emitAction('user.create', {
 * 	key: created.id,
 * 	payload,
 * });
 * ```
 */
export class Emitter {
	/**
	 * Channel of the filter handlers, kept apart so a filter never fires as an action of the same name.
	 *
	 * @internal
	 */
	private filterEmitter: ee2.EventEmitter2;

	/**
	 * Channel of the action handlers.
	 *
	 * @internal
	 */
	private actionEmitter: ee2.EventEmitter2;

	/**
	 * Channel of the init handlers.
	 *
	 * @internal
	 */
	private initEmitter: ee2.EventEmitter2;

	/**
	 * The async wrapper registered for each action handler, keyed by the handler itself, so `offAction` can find it.
	 *
	 * @internal
	 */
	private actionWrappers: WeakMap<ActionHandler, ActionHandler> = new WeakMap();

	/**
	 * Create the three channels with identical settings.
	 */
	constructor() {
		const emitterOptions = {
			wildcard: true,
			verboseMemoryLeak: true,
			delimiter: '.',

			// This will ignore the "unspecified event" error
			ignoreErrors: true,
		};

		this.filterEmitter = new ee2.EventEmitter2(emitterOptions);
		this.actionEmitter = new ee2.EventEmitter2(emitterOptions);
		this.initEmitter = new ee2.EventEmitter2(emitterOptions);
	}

	/**
	 * Context handed to handlers when the caller passes none.
	 *
	 * Only accountability is fixed; a database handle or schema is attached by the emitting code, which keeps this
	 * package free of database types.
	 *
	 * @returns An anonymous context.
	 */
	private getDefaultContext(): EventContext {
		return {
			accountability: null,
		};
	}

	/**
	 * Run the filter handlers of one or more events over a payload, in registration order.
	 *
	 * Each handler receives the payload as the previous one left it; a handler returning `undefined` leaves the payload
	 * untouched.
	 *
	 * @typeParam T - Payload the event carries.
	 * @param event - Event name, or several names run one after another.
	 * @param payload - Value the handlers may replace.
	 * @param meta - Details of the operation, merged with the event name.
	 * @param context - Who is acting; defaults to an anonymous context.
	 * @returns The payload after every handler had its turn.
	 */
	public async emitFilter<T>(
		event: string | string[],
		payload: T,
		meta: Record<string, any>,
		context: EventContext | null = null,
	): Promise<T> {
		const events = Array.isArray(event) ? event : [event];

		// 1. Listeners are resolved up front, so a handler registering another one mid-run does not join this run
		const eventListeners = events.map((event) => ({
			event,
			listeners: this.filterEmitter.listeners(event) as FilterHandler<T>[],
		}));

		let updatedPayload = payload;

		// 2. Sequential on purpose: every filter sees the result of the previous one
		for (const { event, listeners } of eventListeners) {
			for (const listener of listeners) {
				const result = await listener(updatedPayload, { event, ...meta }, context ?? this.getDefaultContext());

				if (result !== undefined) {
					updatedPayload = result;
				}
			}
		}

		return updatedPayload;
	}

	/**
	 * Fire the action handlers of one or more events without waiting for them.
	 *
	 * A rejected handler is logged as a warning; the operation that emitted the event is never affected.
	 *
	 * @param event - Event name, or several names.
	 * @param meta - Details of the operation, merged with the event name.
	 * @param context - Who acted; defaults to an anonymous context.
	 */
	public emitAction(event: string | string[], meta: Record<string, any>, context: EventContext | null = null): void {
		// 1. One name or several are handled alike; the logger is read per call, so a `registerLogger` after start-up
		//    is honoured
		const logger = useLogger();
		const events = Array.isArray(event) ? event : [event];

		// 2. Fire and forget: a failed handler is logged, never awaited, and never reaches the caller. Every handler
		//    was wrapped in an async function by `onAction`, so a failure only ever comes back as a rejection here.
		//    Whatever it threw goes to the log as an `Error`, since pino serialises an `Error` under `err` while a
		//    thrown string in first position would be taken for the message and the text after it dropped
		for (const event of events) {
			this.actionEmitter.emitAsync(event, { event, ...meta }, context ?? this.getDefaultContext()).catch((error) => {
				logger.warn(toError(error), `An error was thrown while executing action "${event}"`);
			});
		}
	}

	/**
	 * Run the init handlers of an event and wait for them.
	 *
	 * Failures are logged as warnings rather than thrown, so one broken hook cannot stop the application from starting.
	 *
	 * @param event - Stage name, such as `app.before` or `routes.after`.
	 * @param meta - What the stage exposes to the hooks, merged with the event name.
	 */
	public async emitInit(event: string, meta: Record<string, any>): Promise<void> {
		// 1. The logger is read per call, so a `registerLogger` after start-up is honoured
		const logger = useLogger();

		// 2. Awaited, but a failure is logged rather than thrown; wrapped through `toError` for the same reason as in
		//    `emitAction`: a thrown string must not become the message and swallow the text after it
		try {
			await this.initEmitter.emitAsync(event, { event, ...meta });
		} catch (error) {
			logger.warn(toError(error), `An error was thrown while executing init "${event}"`);
		}
	}

	/**
	 * Register a filter handler.
	 *
	 * @typeParam T - Payload the event carries.
	 * @param event - Event name, wildcards allowed.
	 * @param handler - Handler that may replace the payload.
	 */
	public onFilter<T = unknown>(event: string, handler: FilterHandler<T>): void {
		this.filterEmitter.on(event, handler);
	}

	/**
	 * Register an action handler.
	 *
	 * A handler that throws synchronously is as isolated as one that rejects: the other handlers of the event still
	 * run, and the failure goes to the log.
	 *
	 * @param event - Event name, wildcards allowed.
	 * @param handler - Handler run after the operation.
	 */
	public onAction(event: string, handler: ActionHandler): void {
		// 1. eventemitter2 calls the handlers in a plain loop and only collects their promises, so one throwing before
		//    its first `await` would stop the loop and skip the handlers after it. Wrapped in an async function, a
		//    throw becomes a rejection like any other, and every handler of the event gets its turn
		const wrapper: ActionHandler = async (meta, context) => {
			await handler(meta, context);
		};

		// 2. The same wrapper is registered under the same handler every time, so `offAction` removes what `onAction`
		//    added, and registering one handler twice behaves as eventemitter2 would with the handler itself
		this.actionWrappers.set(handler, wrapper);
		this.actionEmitter.on(event, wrapper);
	}

	/**
	 * Register an init handler.
	 *
	 * @param event - Stage name, wildcards allowed.
	 * @param handler - Handler run at that stage of start-up.
	 */
	public onInit(event: string, handler: InitHandler): void {
		this.initEmitter.on(event, handler);
	}

	/**
	 * Count the filter handlers subscribed to an event.
	 *
	 * @param event - Event name. Required as the emitter throws without one due to `wildcard: true`.
	 * @returns Number of registered filters matching the given event.
	 */
	public countFilterListeners(event: string): number {
		return this.filterEmitter.listenerCount(event);
	}

	/**
	 * Count the action handlers subscribed to an event.
	 *
	 * @param event - Event name. Required as the emitter throws without one due to `wildcard: true`.
	 * @returns Number of registered action handlers matching the given event.
	 */
	public countActionListeners(event: string): number {
		return this.actionEmitter.listenerCount(event);
	}

	/**
	 * Count the init handlers subscribed to an event.
	 *
	 * @param event - Event name. Required as the emitter throws without one due to `wildcard: true`.
	 * @returns Number of registered init handlers matching the given event.
	 */
	public countInitListeners(event: string): number {
		return this.initEmitter.listenerCount(event);
	}

	/**
	 * Remove a filter handler.
	 *
	 * @typeParam T - Payload the event carries.
	 * @param event - Event name it was registered under.
	 * @param handler - The very function that was registered.
	 */
	public offFilter<T = unknown>(event: string, handler: FilterHandler<T>): void {
		this.filterEmitter.off(event, handler);
	}

	/**
	 * Remove an action handler.
	 *
	 * @param event - Event name it was registered under.
	 * @param handler - The very function that was registered.
	 */
	public offAction(event: string, handler: ActionHandler): void {
		// 1. What was registered is the wrapper, not the handler; a handler never registered has none and nothing to
		//    remove
		const wrapper = this.actionWrappers.get(handler);

		if (wrapper) {
			this.actionEmitter.off(event, wrapper);
		}
	}

	/**
	 * Remove an init handler.
	 *
	 * @param event - Stage name it was registered under.
	 * @param handler - The very function that was registered.
	 */
	public offInit(event: string, handler: InitHandler): void {
		this.initEmitter.off(event, handler);
	}

	/**
	 * Remove every handler from every channel.
	 *
	 * Used when hooks are reloaded, so the old generation does not keep running next to the new one.
	 */
	public offAll(): void {
		this.filterEmitter.removeAllListeners();
		this.actionEmitter.removeAllListeners();
		this.initEmitter.removeAllListeners();
	}
}
