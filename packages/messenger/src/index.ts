/**
 * Public entry point of `@novastarter/messenger`.
 *
 * Messenger messages in three parts: the {@link MessengerDriver} contract with the built-in `console` driver (the
 * messengers live in the `@novastarter/messenger-driver-*` packages), the {@link MessengerManager} of
 * {@link useMessenger} mapping named locations — one bot each — to drivers, and {@link sendMessage}, which checks a
 * message and sends it through its location.
 */
export type { MessengerDriver } from './driver.js';
export { MessengerTargetGoneError, type MessengerTargetGoneErrorExtensions } from './errors/index.js';
export { MessengerDriverConsole, type MessengerDriverConsoleConfig } from './lib/drivers/index.js';
export { MessengerManager, type MessengerDrivers } from './lib/messenger-manager.js';
export {
	DEFAULT_MESSENGER_LOCATION,
	MESSENGER_FAILED_EVENT,
	MESSENGER_GONE_EVENT,
	MESSENGER_SEND_FILTER,
	MESSENGER_SENT_EVENT,
	sendMessage,
	type MessengerSendOptions,
	type MessengerSendResult,
} from './lib/send-message.js';
export { useMessenger } from './lib/use-messenger.js';
export type { MessengerAttachment, MessengerFormat, MessengerMessage, MessengerResult } from './types.js';
