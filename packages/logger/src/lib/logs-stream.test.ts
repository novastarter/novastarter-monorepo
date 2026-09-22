/**
 * Tests of `logger/lib/logs-stream`.
 *
 * `processId` is mocked for a stable node id and the bus is a stub, so these exercise the shaping of the lines alone.
 */
import { randomUUID } from 'node:crypto';
import { omit } from 'lodash-es';
import { afterEach, expect, test, vi } from 'vitest';
import { type LogsBus, LogsStream } from './logs-stream.js';

vi.mock('@novastarter/utils/node', () => ({
	processId: () => {
		return 'a-process-id';
	},
}));

// The bus answers a promise; the stream chains on it, so the mock has to as well
const messenger = {
	publish: vi.fn(async () => {}),
} as unknown as LogsBus;

afterEach(() => {
	vi.clearAllMocks();
});

const sample = {
	log: {
		level: 30,
		time: new Date().getTime(),
		msg: `This is a ${randomUUID()} log`,
	},
	httpLog: {
		level: 30,
		time: new Date().getTime(),
		msg: `This is a ${randomUUID()} log`,
		req: {
			method: randomUUID(),
			url: randomUUID(),
		},
		res: {
			statusCode: randomUUID(),
		},
		responseTime: randomUUID(),
	},
};

test('Publishes raw log when pretty is false', () => {
	// 1. Raw mode wraps the line as it came; the id of the process rides along so a reader can tell the nodes apart
	const logStream = new LogsStream(false, messenger);
	const logString = JSON.stringify(sample.log);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.log,
			nodeId: 'a-process-id',
		}),
	);
});

test('Publishes http log when pretty is false', () => {
	// 1. Request fields stay untouched in raw mode: folding is a pretty concern
	const logStream = new LogsStream(false, messenger);
	const logString = JSON.stringify(sample.httpLog);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.httpLog,
			nodeId: 'a-process-id',
		}),
	);
});

test('Publishes prettified log when pretty is basic', () => {
	// 1. The basic shape keeps exactly the fields a log viewer shows
	const logStream = new LogsStream('basic', messenger);
	const logString = JSON.stringify(sample.log);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.log,
			nodeId: 'a-process-id',
		}),
	);
});

test('Publishes prettified http log when pretty is http', () => {
	// 1. A line without its request fields cannot fold, so it falls back to the basic shape
	const logStream = new LogsStream('http', messenger);
	const logString = JSON.stringify(omit(sample.httpLog, ['req', 'res', 'responseTime']));

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: {
				level: sample.httpLog.level,
				time: sample.httpLog.time,
				msg: sample.httpLog.msg,
			},
			nodeId: 'a-process-id',
		}),
	);
});

test('Folds request fields into one message when pretty is http', () => {
	// 1. Method, URL, status and duration become the one message a reader scans for
	const logStream = new LogsStream('http', messenger);

	logStream._write(JSON.stringify(sample.httpLog), '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: {
				level: sample.httpLog.level,
				time: sample.httpLog.time,
				msg: `${sample.httpLog.req.method} ${sample.httpLog.req.url} ${sample.httpLog.res.statusCode} ${sample.httpLog.responseTime}ms`,
			},
			nodeId: 'a-process-id',
		}),
	);
});

test('Folds a request served in under a millisecond, whose responseTime is 0', () => {
	// 1. pino-http counts whole milliseconds, so a fast request reports `0`; a truthiness check would drop it to the
	//    basic shape and lose method, URL and status
	const logStream = new LogsStream('http', messenger);
	const fast = { ...sample.httpLog, res: { statusCode: 200 }, responseTime: 0 };

	logStream._write(JSON.stringify(fast), '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: {
				level: fast.level,
				time: fast.time,
				msg: `${fast.req.method} ${fast.req.url} 200 0ms`,
			},
			nodeId: 'a-process-id',
		}),
	);
});

test('Escapes quotes in error messages', () => {
	// 1. A message with quotes survives the string interpolation of raw mode
	const logStream = new LogsStream('basic', messenger);

	const log = {
		level: 30,
		time: new Date().getTime(),
		msg: `Am I "'escaped'"=?`,
	};

	logStream._write(JSON.stringify(log), '', () => {});

	expect(messenger.publish).toBeCalledWith('logs', JSON.stringify({ log, nodeId: 'a-process-id' }));
});

test('Drops a line the bus refuses instead of failing the stream or the process', async () => {
	// 1. The bus mirrors the log: a Redis outage must not turn every line into an unhandled rejection. A plain
	//    function stands in for the bus here — a `vi.fn` would attach its own handler to the promise and hide an
	//    unhandled one
	const unhandled = vi.fn();
	process.on('unhandledRejection', unhandled);

	try {
		const refusing: LogsBus = { publish: () => Promise.reject(new Error('bus down')) };
		const logStream = new LogsStream(false, refusing);

		const callback = vi.fn();
		expect(() => logStream._write(JSON.stringify(sample.log), '', callback)).not.toThrow();
		expect(callback).toHaveBeenCalledWith();

		// 2. Unhandled rejections are reported on a later turn of the event loop
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(unhandled).not.toHaveBeenCalled();
	} finally {
		process.off('unhandledRejection', unhandled);
	}
});
