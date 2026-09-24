import { DriverManager } from '@novastarter/utils';
import type { MessengerDriver } from '../driver.js';
import { MessengerDriverConsole, type MessengerDriverConsoleConfig } from './drivers/console.js';

/**
 * Messenger drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in one is listed here; a driver package adds its own with a module augmentation —
 * `declare module '@novastarter/messenger' { interface MessengerDrivers { telegram: MessengerDriverTelegramConfig } }`
 * — so a location's `options` are checked against the driver it names.
 */
export interface MessengerDrivers {
	/** {@link MessengerDriverConsole}. */
	console: MessengerDriverConsoleConfig;
}

/**
 * Registry of named messenger locations — one bot or workspace each — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for messengers: the built-in `console` driver is registered on construction,
 * a messenger's driver by the application. There is no fallback chain: a chat id belongs to one bot, so another bot
 * cannot deliver it. The application wires it at start-up through `useMessenger()`.
 *
 * @example
 * ```ts
 * const messenger = new MessengerManager();
 *
 * messenger.registerDriver('telegram', MessengerDriverTelegram);
 * messenger.registerLocation('telegram', {
 * 	driver: 'telegram',
 * 	options: { token: env.TELEGRAM_BOT_TOKEN },
 * });
 * ```
 */
export class MessengerManager extends DriverManager<MessengerDriver, MessengerDrivers> {
	/**
	 * Create the registry with the built-in driver already registered.
	 */
	constructor() {
		super();

		// Registering the package's own driver here spares every application the same line, and a replacement under the
		// same name still wins
		this.registerDriver('console', MessengerDriverConsole);
	}
}
