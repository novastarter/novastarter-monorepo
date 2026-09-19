import { Writable } from 'node:stream';
import type { Bus } from '@novastarter/memory';
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
	messenger: Bus;

	/** Shape applied to every line, see {@link PrettyType}. */
	pretty: PrettyType;

	/**
	 * Create the stream.
	 *
	 * @param pretty - Shape applied to every line.
	 * @param messenger - Bus the lines are published on.
	 */
	constructor(pretty: PrettyType, messenger: Bus) {
		// Object mode, so pino hands over whole lines rather than arbitrary byte chunks
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
			this.messenger.publish('logs', `{"log":${chunk},"nodeId":"${nodeId}"}`);
			return callback();
		}

		const log = JSON.parse(chunk);

		// 2. An HTTP line carries request and response objects; they are folded into a single readable message
		if (this.pretty === 'http' && log.req?.method && log.req?.url && log.res?.statusCode && log.responseTime) {
			this.messenger.publish(
				'logs',
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
		this.messenger.publish(
			'logs',
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
}
