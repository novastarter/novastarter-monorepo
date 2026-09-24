/**
 * Public entry point of `@novastarter/messenger-driver-telegram`: the {@link MessengerDriverTelegram} class and its
 * options, {@link sendTelegram} for a message without registration, {@link escapeMarkdownV2} for values in Markdown
 * text, and the mapping of a message to a Bot API call.
 */
export {
	DEFAULT_TELEGRAM_TIMEOUT,
	MessengerDriverTelegram,
	TELEGRAM_API_URL,
	type MessengerDriverTelegramConfig,
} from './lib/driver.js';
export { escapeMarkdownV2 } from './lib/escape-markdown.js';
export { sendTelegram, type SendTelegramOptions } from './lib/send-telegram.js';
export { toTelegramError, type TelegramErrorAnswer } from './lib/to-telegram-error.js';
export { toParseMode, toTelegramRequest, type TelegramRequest } from './lib/to-telegram-request.js';
