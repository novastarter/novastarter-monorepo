/**
 * Tests of `logger/lib/logs-stream`.
 *
 * `nanoid` is mocked for a stable node id and the bus is a stub, so these exercise the shaping of the lines alone.
 */
import { randomUUID } from 'node:crypto';
import type { Bus } from '@novastarter/memory';
import { omit } from 'lodash-es';
import { afterEach, expect, test, vi } from 'vitest';
import { LogsStream } from './logs-stream.js';

vi.mock('nanoid', () => ({
	nanoid: () => {
		return 'a-nanoid';
	},
}));

const messenger = {
	publish: vi.fn(),
} as unknown as Bus;

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
	const logStream = new LogsStream(false, messenger);
	const logString = JSON.stringify(sample.log);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.log,
			nodeId: 'a-nanoid',
		}),
	);
});

test('Publishes http log when pretty is false', () => {
	const logStream = new LogsStream(false, messenger);
	const logString = JSON.stringify(sample.httpLog);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.httpLog,
			nodeId: 'a-nanoid',
		}),
	);
});

test('Publishes prettified log when pretty is basic', () => {
	const logStream = new LogsStream('basic', messenger);
	const logString = JSON.stringify(sample.log);

	logStream._write(logString, '', () => {});

	expect(messenger.publish).toBeCalledWith(
		'logs',
		JSON.stringify({
			log: sample.log,
			nodeId: 'a-nanoid',
		}),
	);
});

test('Publishes prettified http log when pretty is http', () => {
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
			nodeId: 'a-nanoid',
		}),
	);
});

test('Folds request fields into one message when pretty is http', () => {
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
			nodeId: 'a-nanoid',
		}),
	);
});

test('Escapes quotes in error messages', () => {
	const logStream = new LogsStream('basic', messenger);

	const log = {
		level: 30,
		time: new Date().getTime(),
		msg: `Am I "'escaped'"=?`,
	};

	logStream._write(JSON.stringify(log), '', () => {});

	expect(messenger.publish).toBeCalledWith('logs', JSON.stringify({ log, nodeId: 'a-nanoid' }));
});
