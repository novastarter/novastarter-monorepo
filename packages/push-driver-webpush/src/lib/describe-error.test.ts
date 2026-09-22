/**
 * Tests of `describe-error`: how what `web-push` throws becomes the error `sendPush()` reports.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { describe, expect, test } from 'vitest';
import { WebPushError } from 'web-push';
import { describeError } from './describe-error.js';

/**
 * The endpoint a push service answers for; it names the target in every message.
 */
const endpoint = 'https://push.example/abc';

describe('describeError', () => {
	test('Reports a 404 or 410 as a gone target naming the status and endpoint', () => {
		// 1. A 410 is Chrome's answer for an unsubscribed browser: the error the caller deletes the subscription on, the
		//    library's error as the cause so the handler can reach the status
		const gone410 = new WebPushError('x', 410, {}, '', endpoint);

		expect(describeError(gone410)).toMatchObject({
			extensions: { platform: 'webpush', reason: `410 from ${endpoint}` },
			cause: gone410,
		});

		// 2. A 404 is what Firefox and Safari answer for the same thing, so it is as gone as a 410
		const gone404 = new WebPushError('x', 404, {}, '', endpoint);
		const gone = describeError(gone404);

		expect(gone).toBeInstanceOf(PushTargetGoneError);
		expect(gone).toMatchObject({ extensions: { platform: 'webpush', reason: `404 from ${endpoint}` }, cause: gone404 });
	});

	test('Names any other status and the trimmed body, keeping the library error as the cause', () => {
		// 1. The body is the push service's own explanation, so it is kept; the cause keeps the status code reachable
		const refused = new WebPushError('x', 413, {}, ' payload too large \n', endpoint);

		expect(describeError(refused)).toMatchObject({
			message: `Web push: 413 from ${endpoint}: payload too large`,
			cause: refused,
		});

		// 2. An empty body adds no trailing colon
		const empty = new WebPushError('x', 500, {}, '', endpoint);

		expect(describeError(empty)).toMatchObject({ message: `Web push: 500 from ${endpoint}`, cause: empty });
	});

	test('Prefixes anything that is not a service answer and passes it on as the cause', () => {
		// 1. A network failure never reached the service, so there is no status to report: only the message
		const socket = new Error('Socket timeout');

		expect(describeError(socket)).toMatchObject({ message: 'Web push: Socket timeout', cause: socket });

		// 2. A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'Web push: boom', cause: 'boom' });
	});
});
