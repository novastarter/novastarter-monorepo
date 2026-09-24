/**
 * Tests of `messenger-driver-telegram/lib/send-telegram` with `fetch` stubbed.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { sendTelegram } from './send-telegram.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

test('Sends one message without any registration', async () => {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 3 } })));

	vi.stubGlobal('fetch', fetchMock);

	await expect(
		sendTelegram({
			token: '123:abc',
			apiUrl: 'http://bot-api.local',
			chatId: '-100',
			text: 'Deploy finished',
			silent: true,
		}),
	).resolves.toMatchObject({ messageId: '3' });

	const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

	expect(url).toBe('http://bot-api.local/bot123:abc/sendMessage');

	expect(JSON.parse(init.body as string)).toStrictEqual({
		chat_id: '-100',
		disable_notification: true,
		text: 'Deploy finished',
	});
});
