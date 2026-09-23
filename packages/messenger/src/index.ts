/**
 * Public entry point of `@novastarter/messenger`.
 *
 * Messenger messages in three parts: the {@link MessengerDriver} contract with the built-in `console` driver (the
 * messengers live in the `@novastarter/messenger-driver-*` packages), the {@link MessengerManager} of
 * {@link useMessenger} mapping named locations — one bot each — to drivers, and {@link sendMessage}, which checks a
 * message and sends it through its location.
 */
export * from './driver.js';
export * from './errors/index.js';
export * from './lib/drivers/index.js';
export * from './lib/messenger-manager.js';
export * from './lib/send-message.js';
export * from './lib/use-messenger.js';
export * from './types.js';
