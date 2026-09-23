import { Writable } from 'node:stream';
import { processId } from '@novastarter/utils/node';

/**
 * How a log line is shaped before it is published: `basic` keeps level, time and message, `http` folds the request
 * fields into one message, `false` forwards the raw JSON line.
 */
export type PrettyType = 'basic' | 'http' | false;

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
	 * Identifier of this process, attached to every published line so a reader of a multi-instance stream can tell
	 * the nodes apart.
	 *
	 * Resolved in the constructor rather than at import time: the package declares no side effects, so a bundler
	 * may drop or defer a module whose import runs code, and `processId()` must not run before a stream exists.
	 */
	private readonly nodeId: string;

	/**
	 * Create the stream.
	 *
	 * @param pretty - Shape applied to every line.
	 * @param messenger - Bus the lines are published on.
	 */
	constructor(pretty: PrettyType, messenger: LogsBus) {
		// 1. Object mode, so pino hands over whole lines rather than arbitrary byte chunks
		super({ objectMode: true });

		// 2. The process id is taken on construction, not at import: `processId()` memoises, so every stream of
		//    this process still shares one id
		this.nodeId = processId();

		this.messenger = messenger;
		this.pretty = pretty;
	}

	/**
	 * Publish one log line.
	 *
	 * @param chunk - JSON line as pino produced it; a chunk that is not a string — a Buffer piped into the
	 * multistream, for one — cannot be read and is published as the fallback line instead.
	 * @param _encoding - Ignored, the chunk is already a string.
	 * @param callback - Signals the stream that the line was handled.
	 */
	override _write(chunk: string, _encoding: string, callback: (error?: Error | null) => void): void {
		// 1. Anything but pino can write into a multistream, and only a string chunk carries the line: a Buffer has
		//    no `replace` and its string form is still a foreign byte sequence, so a non-string chunk is reported as
		//    the fallback line rather than thrown — the stream has no `error` listener, so a throw would crash the
		//    process
		if (typeof chunk !== 'string') {
			this.publishUnreadableLine();

			return callback();
		}

		// 2. Pino terminates every line with a newline, which object mode preserves; stripping the terminator keeps it
		//    from ending up embedded inside the published JSON payload
		const line = chunk.replace(/\r?\n$/, '');

		let log: Record<string, any>;

		// 3. Anything but pino can write into a multistream, and a foreign or corrupted line is not JSON. Raw mode
		//    interpolates the line into the payload, which would hand every subscriber a syntactically invalid
		//    message, so the line is validated exactly like the pretty branch does; the parse result is discarded in
		//    raw mode, where the original line is forwarded so its exact content and field order survive
		try {
			log = JSON.parse(line);
		} catch {
			this.publishUnreadableLine();

			return callback();
		}

		// 4. Raw mode wraps the validated line by string interpolation on purpose: parsing and re-serialising every
		//    line would cost more than the whole logging call
		if (!this.pretty) {
			this.publish(`{"log":${line},"nodeId":"${this.nodeId}"}`);
			return callback();
		}

		// 5. An HTTP line carries request and response objects; they are folded into a single readable message. The
		//    duration is tested for presence, not truth: pino-http counts whole milliseconds, so a request served in
		//    under one reports `0`, and it must fold like any other
		if (
			this.pretty === 'http' &&
			log['req']?.method &&
			log['req']?.url &&
			log['res']?.statusCode != null &&
			log['responseTime'] != null
		) {
			this.publish(
				JSON.stringify({
					log: {
						level: log['level'],
						time: log['time'],
						msg: `${log['req'].method} ${log['req'].url} ${log['res'].statusCode} ${log['responseTime']}ms`,
					},
					nodeId: this.nodeId,
				}),
			);

			return callback();
		}

		// 6. Every other line keeps only the fields a log viewer shows
		this.publish(
			JSON.stringify({
				log: {
					level: log['level'],
					time: log['time'],
					msg: log['msg'],
				},
				nodeId: this.nodeId,
			}),
		);

		callback();
	}

	/**
	 * Publish the fallback line that stands in for a chunk that is not JSON.
	 *
	 * Shared by the raw and the pretty paths, so a foreign or corrupted line is reported the same way whichever
	 * shape the stream publishes.
	 *
	 * @internal
	 */
	private publishUnreadableLine(): void {
		// 1. A fixed error line keeps the stream and its subscribers alive; its time marks when the bad chunk arrived
		this.publish(
			JSON.stringify({
				log: { level: 50, time: Date.now(), msg: 'Received an unreadable log line' },
				nodeId: this.nodeId,
			}),
		);
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
