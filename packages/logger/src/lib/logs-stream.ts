import { Writable } from 'node:stream';
import { nanoid } from 'nanoid';

/**
 * How a log line is shaped before it is published: `basic` keeps level, time and message, `http` folds the request
 * fields into one message, `false` forwards the raw JSON line.
 */
export type PrettyType = 'basic' | 'http' | false;

/**
 * Identifier of this process, attached to every published line so a reader of a multi-instance stream can tell the
 * nodes apart.
 */
const nodeId = nanoid(8);

/**
 * The part of a message bus {@link LogsStream} needs: publishing a line on a channel.
 *
 * Structural on purpose, so the `BusDriver` of `@novastarter/memory` fits without this package depending on it, and
 * a test can pass a plain object.
 */
export interface LogsBus {
	/**
	 * Publish a message on a channel.
	 *
	 * @param channel - Channel name; always `logs` here.
	 * @param payload - The serialised log line.
	 * @returns Resolves once the message is handed to the backend.
	 */
	publish(channel: string, payload: string): Promise<void>;
}

/**
 * Writable stream that publishes every log line on the message bus.
 *
 * Pino writes JSON lines into it; each becomes a `logs` message on the bus, which is what lets a dashboard or a CLI
 * tail the logs of every instance at once. The bus is injected rather than looked up, so the package stays free of
 * Redis wiring.
 *
 * @example
 * ```ts
 * const stream = new LogsStream('basic', bus);
 * const logger = pino({}, pino.multistream([{ level: 'info', stream }]));
 * ```
 */
export class LogsStream extends Writable {
	/** Bus the lines are published on. */
	messenger: LogsBus;

	/** Shape applied to every line, see {@link PrettyType}. */
	pretty: PrettyType;

	/**
	 * Create the stream.
	 *
	 * @param pretty - Shape applied to every line.
	 * @param messenger - Bus the lines are published on.
	 */
	constructor(pretty: PrettyType, messenger: LogsBus) {
		// 1. Object mode, so pino hands over whole lines rather than arbitrary byte chunks
		super({ objectMode: true });
		this.messenger = messenger;
		this.pretty = pretty;
	}

	/**
	 * Publish one log line.
	 *
	 * @param chunk - JSON line as pino produced it.
	 * @param _encoding - Ignored, the chunk is already a string.
	 * @param callback - Signals the stream that the line was handled.
	 */
	override _write(chunk: string, _encoding: string, callback: (error?: Error | null) => void): void {
		// 1. Raw mode wraps the line by string interpolation on purpose: parsing and re-serialising every line would cost
		// more than the whole logging call
		if (!this.pretty) {
			this.publish(`{"log":${chunk},"nodeId":"${nodeId}"}`);
			return callback();
		}

		const log = JSON.parse(chunk);

		// 2. An HTTP line carries request and response objects; they are folded into a single readable message
		if (this.pretty === 'http' && log.req?.method && log.req?.url && log.res?.statusCode && log.responseTime) {
			this.publish(
				JSON.stringify({
					log: {
						level: log['level'],
						time: log['time'],
						msg: `${log.req.method} ${log.req.url} ${log.res.statusCode} ${log.responseTime}ms`,
					},
					nodeId: nodeId,
				}),
			);

			return callback();
		}

		// 3. Every other line keeps only the fields a log viewer shows
		this.publish(
			JSON.stringify({
				log: {
					level: log['level'],
					time: log['time'],
					msg: log['msg'],
				},
				nodeId: nodeId,
			}),
		);

		callback();
	}

	/**
	 * Publish one line on the `logs` channel without waiting for it, and without letting a failure escape.
	 *
	 * The bus is a mirror of the log, not its store: the line already went to the process's other streams. A publish
	 * that fails — the Redis of the bus is down, the payload could not be compressed — must not turn into an unhandled
	 * rejection that ends the process, and cannot be logged either, since the logger is what is writing here. The
	 * bus's own connection reports its trouble through its client.
	 *
	 * @param payload - The serialised line.
	 * @internal
	 */
	private publish(payload: string): void {
		// 1. Fire and forget; the failure is observed so it is not reported as unhandled, and dropped for the reasons above
		this.messenger.publish('logs', payload).catch(() => {});
	}
}
