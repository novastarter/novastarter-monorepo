/**
 * Public entry point of `@novastarter/push`.
 *
 * Push notifications in three parts: the {@link PushDriver} contract with the built-in `console` driver (vendor SDKs
 * live in the `@novastarter/push-driver-*` packages), the {@link PushManager} of {@link usePush} mapping named
 * locations to drivers and holding the routes the application registers at start-up, and {@link sendPush}, which
 * validates a message's target and sends it through the location of its platform.
 */
export type { PushDriver } from './driver.js';
export { PushTargetGoneError, type PushTargetGoneErrorExtensions } from './errors/index.js';
export { COLLAPSE_ID_MAX_LENGTH, toCollapseId } from './lib/collapse-id.js';
export { PushDriverConsole, type PushDriverConsoleConfig } from './lib/drivers/index.js';
export { platformOf } from './lib/platform-of.js';
export { PushManager, type PushDrivers, type PushRoutes } from './lib/push-manager.js';
export {
	PUSH_FAILED_EVENT,
	PUSH_GONE_EVENT,
	PUSH_SEND_FILTER,
	PUSH_SENT_EVENT,
	sendPush,
	type PushSendOptions,
	type PushSendResult,
} from './lib/send-push.js';
export { toWebPushPayload } from './lib/to-web-push-payload.js';
export { usePush } from './lib/use-push.js';
export {
	PUSH_PLATFORMS,
	TOKEN_PLATFORMS,
	type PushMessage,
	type PushPlatform,
	type PushResult,
	type PushUrgency,
	type WebPushPayload,
	type WebPushSubscription,
} from './types.js';
