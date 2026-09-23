import { type Singleton, singleton } from '@novastarter/utils';
import { MessengerManager } from './messenger-manager.js';

/**
 * Return the process-wide {@link MessengerManager}, creating one with only the built-in driver on first use.
 *
 * The application registers its messenger drivers and locations on it at start-up; `sendMessage()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call; `useMessenger.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const messenger = useMessenger();
 *
 * messenger.registerDriver('telegram', MessengerDriverTelegram);
 * messenger.registerLocation('default', {
 * 	driver: 'telegram',
 * 	options: { token: env.TELEGRAM_BOT_TOKEN },
 * });
 *
 * // anywhere later
 * await sendMessage({ to: chatId, text: 'Invoice 1042 is paid' });
 * ```
 */
export const useMessenger: Singleton<MessengerManager> = singleton(() => new MessengerManager());
