/**
 * Tests of the Telegram driver class with `fetch` stubbed: what reaches the Bot API — URL, body, headers — and what
 * the driver makes of its answer.
 *
 * Covered: the constructor check and the named export, a text message, an upload as multipart, an album, `call()`
 * for a method without a wrapper, `verify()`, a refusal, an answer that is not JSON, and the timeout.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { MessengerTargetGoneError } from '@novastarter/messenger';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { MessengerDriverTelegram, TELEGRAM_API_URL } from './driver.js';

/**
 * The stubbed `fetch`: answers `{ ok: true, result }` with the result a test sets.
 */
const fetchMock = vi.fn();

/**
 * Make `fetch` answer once with a JSON body.
 *
 * @param body - The body.
 * @param status - The HTTP status.
 */
const answer = (body: unknown, status = 200): void => {
	// A real `Response`, so the driver reads it the way it reads Telegram's
	fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
};

/**
 * The URL and the init of the n-th `fetch` call.
 *
 * @param index - Which call.
 * @returns The URL and the init.
 */
const request = (index = 0): { url: string; init: RequestInit } => {
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];

	return { url, init };
};

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe('constructor', () => {
	test('Refuses a missing token, and is exported by name only', () => {
		// Fails at the location's first use rather than on the first message
		expect(() => new MessengerDriverTelegram({ token: '' })).toThrow(
			new InvalidConfigError({ reason: 'The Telegram driver needs a bot "token"' }),
		);

		expect(entry.MessengerDriverTelegram).toBe(MessengerDriverTelegram);
		expect(entry).not.toHaveProperty('default');
	});

	test('Refuses an apiUrl that is not a URL, naming neither it nor the token', () => {
		// Caught here, a call never builds an invalid URL whose `TypeError` would hold the token
		const error = ((): Error | undefined => {
			try {
				new MessengerDriverTelegram({ token: '123:secret-token', apiUrl: 'not a url' });

				return undefined;
			} catch (thrown) {
				return thrown as Error;
			}
		})();

		expect(error).toBeInstanceOf(InvalidConfigError);
		expect(error?.message).toBe('Invalid config. The Telegram driver\'s "apiUrl" is not a valid URL.');
		expect(JSON.stringify(error)).not.toContain('secret-token');
		expect(error?.message).not.toContain('not a url');
	});

	test('Refuses a malformed token before it can corrupt the request URL, naming neither', () => {
		// A `#`, `?` or `/` in the token would split the path of `/bot<token>/<method>` into a confusing 404; a bot
		// token is `<id>:<hash>`, so anything else is refused here, at construction
		const error = ((): Error | undefined => {
			try {
				new MessengerDriverTelegram({ token: '123:bad#token' });

				return undefined;
			} catch (thrown) {
				return thrown as Error;
			}
		})();

		expect(error).toBeInstanceOf(InvalidConfigError);

		expect(error?.message).toBe(
			'Invalid config. The Telegram driver\'s "token" is not a bot token of the shape "<id>:<hash>".',
		);

		expect(JSON.stringify(error)).not.toContain('bad#token');
	});
});

describe('send', () => {
	test('Posts a text message as JSON to the bot’s method and answers its id', async () => {
		answer({ ok: true, result: { message_id: 7 } });

		await expect(
			new MessengerDriverTelegram({ token: '123:abc' }).send({ to: '42', text: 'Hi' }),
		).resolves.toStrictEqual({
			messageId: '7',
			raw: { message_id: 7 },
		});

		const { url, init } = request();

		expect(url).toBe(`${TELEGRAM_API_URL}/bot123:abc/sendMessage`);
		expect(init.method).toBe('POST');

		expect(init.headers).toStrictEqual({
			accept: 'application/json',
			'user-agent': 'novastarter',
			'content-type': 'application/json',
		});

		expect(JSON.parse(init.body as string)).toStrictEqual({ chat_id: '42', text: 'Hi' });
	});

	test('Uploads a file as multipart, objects as JSON fields', async () => {
		answer({ ok: true, result: [{ message_id: 8 }, { message_id: 9 }] });

		const driver = new MessengerDriverTelegram({ token: '123:abc', apiUrl: 'http://bot-api.local/' });

		await expect(
			driver.send({
				to: '42',
				attachments: [
					{ kind: 'photo', source: 'https://example.com/a.png' },
					{ kind: 'photo', source: new Blob(['png']), filename: 'b.png' },
				],
			}),
		).resolves.toMatchObject({ messageId: '8' });

		const { url, init } = request();
		const form = init.body as FormData;

		expect(url).toBe('http://bot-api.local/bot123:abc/sendMediaGroup');
		expect(init.headers).toStrictEqual({ accept: 'application/json', 'user-agent': 'novastarter' });
		expect(form.get('chat_id')).toBe('42');

		expect(JSON.parse(form.get('media') as string)).toStrictEqual([
			{ type: 'photo', media: 'https://example.com/a.png' },
			{ type: 'photo', media: 'attach://file1' },
		]);

		expect((form.get('file1') as File).name).toBe('b.png');
	});

	test('Passes a refusal on as the kit’s error', async () => {
		answer({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);

		await expect(
			new MessengerDriverTelegram({ token: '123:abc' }).send({ to: '42', text: 'Hi' }),
		).rejects.toBeInstanceOf(MessengerTargetGoneError);
	});
});

describe('call', () => {
	test('Calls a method without a wrapper and answers its result, leaving undefined parameters out', async () => {
		answer({ ok: true, result: true });

		await expect(
			new MessengerDriverTelegram({ token: '123:abc' }).call<boolean>('setMessageReaction', {
				chat_id: '42',
				message_id: 7,
				is_big: undefined,
			}),
		).resolves.toMatchObject({ status: 200, data: true });

		expect(request().url).toBe(`${TELEGRAM_API_URL}/bot123:abc/setMessageReaction`);
		expect(JSON.parse(request().init.body as string)).toStrictEqual({ chat_id: '42', message_id: 7 });
	});

	test('Sends a File parameter as multipart with its own name, numbers as text', async () => {
		answer({ ok: true, result: { message_id: 1 } });

		await new MessengerDriverTelegram({ token: '123:abc' }).call('sendPhoto', {
			chat_id: 42,
			photo: new File(['png'], 'chart.png'),
		});

		const form = request().init.body as FormData;

		expect(form.get('chat_id')).toBe('42');
		expect((form.get('photo') as File).name).toBe('chart.png');
	});

	test('Refuses an answer that is not JSON without leaking the token', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));

		// The status is named; the URL, with the token in it, is not
		const error = (await new MessengerDriverTelegram({ token: '123:secret' })
			.call('getMe')
			.catch((caught: unknown) => caught)) as Error;

		expect(error.message).toBe('Telegram answered getMe with HTTP 502 and no JSON');
		expect(error.message).not.toContain('SECRET');
	});

	test('Gives up at the timeout and aborts the request', async () => {
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(new MessengerDriverTelegram({ token: '123:abc', timeout: 10 }).call('getMe')).rejects.toBeInstanceOf(
			TimeoutError,
		);

		expect(request().init.signal?.aborted).toBe(true);
	});

	test('Gives up at the timeout when the headers arrive but the body never ends', async () => {
		// The headers come at once; the body sends one chunk and then stalls, never closing
		fetchMock.mockImplementationOnce(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"ok":true,'));
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		);

		// Reading the body is under the deadline too, so the call fails at the timeout instead of hanging
		await expect(new MessengerDriverTelegram({ token: '123:abc', timeout: 10 }).call('getMe')).rejects.toBeInstanceOf(
			TimeoutError,
		);

		expect(request().init.signal?.aborted).toBe(true);
	});

	test('Takes a timeout, extra headers and a signal per call', async () => {
		answer({ ok: true, result: true });

		await new MessengerDriverTelegram({ token: '123:abc' }).call('getMe', {}, { headers: { 'x-trace': '1' } });

		expect(request().init.headers).toStrictEqual({
			accept: 'application/json',
			'user-agent': 'novastarter',
			'content-type': 'application/json',
			'x-trace': '1',
		});

		const controller = new AbortController();

		controller.abort(new Error('stop'));

		await expect(
			new MessengerDriverTelegram({ token: '123:abc' }).call('getMe', {}, { signal: controller.signal }),
		).rejects.toThrow('stop');
	});

	test('Answers the status, the lower-cased headers and the result, without the envelope', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true,"result":{"id":1}}', { status: 200, headers: { 'X-Request-Id': 'r1' } }),
		);

		await expect(new MessengerDriverTelegram({ token: '123:abc' }).call('getMe')).resolves.toMatchObject({
			status: 200,
			headers: { 'x-request-id': 'r1' },
			data: { id: 1 },
		});
	});
});

describe('verify', () => {
	test('Asks for the bot with getMe', async () => {
		answer({ ok: true, result: { id: 1, is_bot: true } });

		await expect(new MessengerDriverTelegram({ token: '123:abc' }).verify()).resolves.toBeUndefined();
		expect(request().url).toBe(`${TELEGRAM_API_URL}/bot123:abc/getMe`);
	});
});
