/**
 * Public entry point of `@novastarter/messenger-driver-telegram`: the {@link MessengerDriverTelegram} class and its
 * options, {@link sendTelegram} for a message without registration, {@link escapeMarkdownV2} for values in Markdown
 * text, the mapping of a message to a Bot API call, and the default export for consumers that import the driver
 * without a named binding.
 */
import { MessengerDriverTelegram } from './lib/driver.js';

export * from './lib/driver.js';
export * from './lib/escape-markdown.js';
export * from './lib/send-telegram.js';
export * from './lib/to-telegram-error.js';
export * from './lib/to-telegram-request.js';
export default MessengerDriverTelegram;
