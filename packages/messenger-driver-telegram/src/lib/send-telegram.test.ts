/**
 * Tests of `messenger-driver-telegram/lib/send-telegram` with `fetch` stubbed.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { sendTelegram } from './send-telegram.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

test('Sends one message without any registration', async () => {
	// 1. A stub that accepts the message
	const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 3 } })));

	vi.stubGlobal('fetch', fetchMock);

	// 2. The bot's options and the message's are split: the token goes into the URL, the rest into the body
	await expect(
		sendTelegram({ token: 'T', apiUrl: 'http://bot-api.local', chatId: '-100', text: 'Deploy finished', silent: true }),
	).resolves.toMatchObject({ messageId: '3' });

	const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

	expect(url).toBe('http://bot-api.local/botT/sendMessage');

	expect(JSON.parse(init.body as string)).toStrictEqual({
		chat_id: '-100',
		disable_notification: true,
		text: 'Deploy finished',
	});
});
