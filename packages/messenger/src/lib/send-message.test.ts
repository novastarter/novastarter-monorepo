/**
 * Tests of `messenger/lib/send-message` on fake drivers registered through `useMessenger()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { InvalidPayloadError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MessengerDriver } from '../driver.js';
import { MessengerTargetGoneError } from '../errors/index.js';
import type { MessengerMessage, MessengerResult } from '../types.js';
import {
	MESSENGER_FAILED_EVENT,
	MESSENGER_GONE_EVENT,
	MESSENGER_SEND_FILTER,
	MESSENGER_SENT_EVENT,
	sendMessage,
} from './send-message.js';
import { useMessenger } from './use-messenger.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module './messenger-manager.js' {
	interface MessengerDrivers {
		ok: Record<string, never>;
		down: Record<string, never>;
		gone: Record<string, never>;
	}
}

/**
 * The mocked application logger.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * The mocked emitter: the filter passes the message through untouched unless a test says otherwise.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * Every message the `ok` driver was asked to send.
 */
const sent: MessengerMessage[] = [];

/**
 * A driver that accepts every message and records it.
 */
class OkDriver implements MessengerDriver {
	/**
	 * Record the message and accept it.
	 *
	 * @param message - The message.
	 * @returns A fixed id.
	 */
	async send(message: MessengerMessage): Promise<MessengerResult> {
		// 1. Recorded for the assertions, accepted as given
		sent.push(message);

		return { messageId: '7' };
	}
}

/**
 * A driver whose messenger is down.
 */
class DownDriver implements MessengerDriver {
	/**
	 * Refuse every message.
	 *
	 * @throws Always.
	 */
	async send(): Promise<MessengerResult> {
		// 1. What an unreachable API looks like to the caller
		throw new Error('ECONNREFUSED');
	}
}

/**
 * A driver whose every recipient blocked the bot.
 */
class GoneDriver implements MessengerDriver {
	/**
	 * Report the recipient as gone.
	 *
	 * @throws MessengerTargetGoneError, always.
	 */
	async send(): Promise<MessengerResult> {
		// 1. What a blocked bot looks like to the caller
		throw new MessengerTargetGoneError({ reason: 'Forbidden: bot was blocked by the user' });
	}
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as ReturnType<typeof useEmitter>);

	// 1. One location per behaviour; `default` is the one a message without a location goes through
	const manager = useMessenger();

	manager.registerDriver('ok', OkDriver);
	manager.registerDriver('down', DownDriver);
	manager.registerDriver('gone', GoneDriver);
	manager.registerLocation('default', { driver: 'ok', options: {} });
	manager.registerLocation('telegram', { driver: 'ok', options: {} });
	manager.registerLocation('down', { driver: 'down', options: {} });
	manager.registerLocation('gone', { driver: 'gone', options: {} });
});

afterEach(() => {
	useMessenger.reset();
	sent.length = 0;
	vi.clearAllMocks();
});

describe('sendMessage', () => {
	test('Sends through `default`, the message’s location or the option’s, and announces it', async () => {
		// 1. No location anywhere: `default`
		await expect(sendMessage({ to: '42', text: 'Hi' })).resolves.toStrictEqual({ messageId: '7', location: 'default' });

		// 2. The message's own, then the option over it
		await expect(sendMessage({ to: '42', text: 'Hi', location: 'telegram' })).resolves.toMatchObject({
			location: 'telegram',
		});

		await expect(
			sendMessage({ to: '42', text: 'Hi', location: 'down' }, { location: 'telegram' }),
		).resolves.toMatchObject({ location: 'telegram' });

		expect(emitter.emitAction).toHaveBeenCalledWith(MESSENGER_SENT_EVENT, {
			location: 'default',
			to: '42',
			messageId: '7',
		});
	});

	test('Accepts attachments without text', async () => {
		// 1. A photo alone is a message
		await sendMessage({ to: '42', attachments: [{ kind: 'photo', source: 'https://example.com/a.png' }] });

		expect(sent).toHaveLength(1);
	});

	test('Refuses a message without a recipient or without content, before the filter', async () => {
		// 1. Both are the payload's fault
		await expect(sendMessage({ to: ' ', text: 'Hi' })).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(sendMessage({ to: '42', text: '  ' })).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(sendMessage({ to: '42', attachments: [] })).rejects.toBeInstanceOf(InvalidPayloadError);

		expect(emitter.emitFilter).not.toHaveBeenCalled();
	});

	test('Sends what the filter rewrote, checks the rewrite, and sends nothing when dropped', async () => {
		// 1. A redirect to a test chat goes through
		emitter.emitFilter.mockResolvedValueOnce({ to: 'test-chat', text: 'Hi' });

		await sendMessage({ to: '42', text: 'Hi' });

		expect(emitter.emitFilter).toHaveBeenCalledWith(MESSENGER_SEND_FILTER, { to: '42', text: 'Hi' }, {});
		expect(sent[0]!.to).toBe('test-chat');

		// 2. A rewrite that blanked the text is refused, a drop answers `null`
		emitter.emitFilter.mockResolvedValueOnce({ to: '42', text: '' });

		await expect(sendMessage({ to: '42', text: 'Hi' })).rejects.toBeInstanceOf(InvalidPayloadError);

		emitter.emitFilter.mockResolvedValueOnce(null);

		await expect(sendMessage({ to: '42', text: 'Hi' })).resolves.toBeNull();
	});

	test('Refuses a location nobody registered', async () => {
		// 1. A configuration mistake, named
		await expect(sendMessage({ to: '42', text: 'Hi' }, { location: 'slack' })).rejects.toThrow(
			'Messenger location "slack" doesn\'t exist.',
		);
	});

	test('Passes a gone recipient on as is and announces it', async () => {
		// 1. Not wrapped: the caller forgets the chat on this very class
		await expect(sendMessage({ to: '42', text: 'Hi', location: 'gone' })).rejects.toBeInstanceOf(
			MessengerTargetGoneError,
		);

		expect(emitter.emitAction).toHaveBeenCalledWith(MESSENGER_GONE_EVENT, {
			location: 'gone',
			to: '42',
			reason: 'Forbidden: bot was blocked by the user',
		});
	});

	test('Wraps a gone recipient a filter redirected to, so the caller keeps its own chat', async () => {
		// 1. The filter sends to a test chat on the gone location; the caller asked for chat 42
		emitter.emitFilter.mockResolvedValueOnce({ to: 'test-chat', text: 'Hi', location: 'gone' });

		const error = await sendMessage({ to: '42', text: 'Hi', location: 'gone' }).catch((caught: unknown) => caught);

		// 2. A plain error, the gone error as its cause, and the event names the chat actually contacted
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(MessengerTargetGoneError);
		expect((error as Error).cause).toBeInstanceOf(MessengerTargetGoneError);

		expect(emitter.emitAction).toHaveBeenCalledWith(MESSENGER_GONE_EVENT, {
			location: 'gone',
			to: 'test-chat',
			reason: 'Forbidden: bot was blocked by the user',
		});

		// 3. Same chat, but a filter moved it to another location than the caller meant: wrapped as well
		emitter.emitFilter.mockResolvedValueOnce({ to: '42', text: 'Hi', location: 'gone' });

		await expect(sendMessage({ to: '42', text: 'Hi' })).rejects.not.toBeInstanceOf(MessengerTargetGoneError);
	});

	test('Wraps any other failure with the driver’s error as the cause, and announces it', async () => {
		// 1. The job retries on the wrapper; the reason travels as the cause
		const error = await sendMessage({ to: '42', text: 'Hi', location: 'down' }).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Messenger location "down" failed to send');
		expect(((error as Error).cause as Error).message).toBe('ECONNREFUSED');
		expect(emitter.emitAction).toHaveBeenCalledWith(MESSENGER_FAILED_EVENT, { location: 'down', to: '42' });
		expect(logger.warn).toHaveBeenCalled();
	});
});
