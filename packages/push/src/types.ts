/**
 * How a device receives pushes: `webpush` — a browser subscription served by its push service (RFC 8030, VAPID),
 * `fcm` — a Firebase Cloud Messaging registration token of a native app or of a browser on the Firebase SDK, `apns` —
 * a device token of an iOS / macOS app registered with Apple Push Notification service directly.
 */
export type PushPlatform = 'webpush' | 'fcm' | 'apns';

/**
 * Every platform — what the console driver delivers to.
 *
 * @defaultValue `webpush`, `fcm`, `apns`
 */
export const PUSH_PLATFORMS: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

/**
 * The platforms addressed by a token rather than a subscription.
 *
 * @defaultValue `fcm`, `apns`
 */
export const TOKEN_PLATFORMS: readonly PushPlatform[] = ['fcm', 'apns'];

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` hands it out and the app stores it.
 */
export interface WebPushSubscription {
	/** The push service URL the message is posted to. */
	endpoint: string;
	/** The client's ECDH public key (`p256dh`) and authentication secret (`auth`), URL-safe base64. */
	keys: { p256dh: string; auth: string };
	/** When the push service will drop the subscription, in epoch milliseconds; `null` for never. */
	expirationTime?: number | null | undefined;
}

/**
 * How urgent a message is — what the push service and the device use to decide whether to wake a sleeping device.
 * Web Push's `Urgency` header; `high` maps to a high-priority FCM message, the rest to a normal one.
 */
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

/**
 * One push message to one device.
 *
 * Exactly one of `subscription` (web push) and `token` (FCM, APNs) names the target; the location is the one the
 * target was registered with — a browser subscription only works with the VAPID key pair it was created for, a token
 * only with its Firebase project or its Apple app — or the route of the target's platform when unset.
 */
export interface PushMessage {
	/** The browser subscription, for the `webpush` platform. */
	subscription?: WebPushSubscription | undefined;
	/** The registration token, for the `fcm` and `apns` platforms. */
	token?: string | undefined;
	/** Which platform a token belongs to — a stored device knows; `fcm` unless given. Ignored for a subscription. */
	platform?: 'fcm' | 'apns' | undefined;
	/** The location to send through; the route of the target's platform unless given. */
	location?: string | undefined;
	/** Notification title. */
	title: string;
	/** Notification text. */
	body?: string | undefined;
	/** Where a click takes the user; absolute, or relative to the app for web push. */
	url?: string | undefined;
	/** Icon URL, shown next to the text. */
	icon?: string | undefined;
	/** Large image URL, shown below the text. */
	image?: string | undefined;
	/** Badge URL — the small monochrome icon Android shows in the status bar. */
	badge?: string | undefined;
	/**
	 * Collapse key: a new message with the same tag replaces the shown one instead of stacking (`Notification.tag`,
	 * the Web Push `Topic` header, FCM's `collapseKey`, APNs's `apns-collapse-id`).
	 */
	tag?: string | undefined;
	/** Custom key-value pairs the client receives with the notification; FCM takes strings only. */
	data?: Record<string, string> | undefined;
	/** How long the push service keeps the message for an offline device, in seconds; the driver's default unless given. */
	ttl?: number | undefined;
	/** Delivery urgency; `normal` unless given. */
	urgency?: PushUrgency | undefined;
}

/**
 * What a driver answers once the push service accepted the message.
 */
export interface PushResult {
	/** The push service's id of the message, when it hands one out (FCM does, Web Push does not). */
	messageId?: string | undefined;
	/** The provider's own status word (`accepted`, an HTTP status), when it says. */
	status?: string | undefined;
}

/**
 * The payload a web push carries, as the service worker reads it from `PushEvent.data.json()`.
 *
 * The contract between the `webpush` driver and the app's service worker: the worker calls
 * `registration.showNotification(title, { body, icon, image, badge, tag, data })` and opens `data.url` on click.
 */
export interface WebPushPayload {
	title: string;
	body?: string | undefined;
	icon?: string | undefined;
	image?: string | undefined;
	badge?: string | undefined;
	tag?: string | undefined;
	/** The custom data with the click target under `url`. */
	data: Record<string, string>;
}
