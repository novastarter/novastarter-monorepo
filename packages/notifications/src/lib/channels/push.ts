import { type PushMessage, PushTargetGoneError, sendPush } from '@novastarter/push';
import type { NotificationChannel, NotificationDelivery } from '../../channel.js';
import type { NotificationRecipient, PushContent, PushTarget } from '../../types.js';

/**
 * Options of {@link pushChannel}.
 */
export interface PushChannelOptions {
	/**
	 * Forget a device the push service says is gone — an unsubscribed browser, an uninstalled app — so it is not tried
	 * again. Without it the dead target stays, and every notification tries it once more.
	 */
	onGone?: ((target: PushTarget, userId: string) => Promise<void>) | undefined;
}

/**
 * Judge a failed device: forget it when it is gone, or hand the failure back to be thrown once every device was tried.
 *
 * @param error - What `sendPush()` threw.
 * @param target - The device.
 * @param userId - Its user.
 * @param options - The channel's options, with `onGone`.
 * @returns `undefined` for a gone device forgotten; the failure otherwise — `onGone`'s own when forgetting failed.
 * @internal
 */
const judgeFailure = async (
	error: unknown,
	target: PushTarget,
	userId: string,
	options: PushChannelOptions,
): Promise<unknown> => {
	// Anything but a gone device is a failure the job retries
	if (!(error instanceof PushTargetGoneError)) {
		return error;
	}

	// A gone device is forgotten now; a failure to forget is retried instead of losing the chance to clean up
	try {
		await options.onGone?.(target, userId);

		return undefined;
	} catch (goneError) {
		return goneError;
	}
};

/**
 * The push channel: the rendered message to every device of the user, through `sendPush()` of `@novastarter/push`.
 *
 * Every device is tried even when one fails, so one broken token does not keep the message from the others; a gone
 * device goes to `onGone` and does not count as a failure. When another device failed, the first failure is thrown
 * after the others were tried, and the job retries — the devices that got the message get it again then, which is why
 * a push should carry a `tag`, so a repeat replaces the shown one instead of stacking.
 *
 * @param options - What to do with a gone device.
 * @returns The channel, named `push`.
 * @example
 * ```ts
 * registerNotifications({
 * 	channels: [pushChannel({ onGone: (target) => deletePushTarget(target) })],
 * 	findRecipient,
 * 	render,
 * });
 * ```
 */
export const pushChannel = (options: PushChannelOptions = {}): NotificationChannel<PushContent> => ({
	name: 'push',

	/**
	 * Whether the user has a device.
	 *
	 * @param recipient - Where the user can be reached.
	 * @returns `true` with at least one push target.
	 */
	reaches(recipient: NotificationRecipient): boolean {
		return (recipient.pushTargets?.length ?? 0) > 0;
	},

	/**
	 * Send the message to every device of the user.
	 *
	 * @param delivery - The recipient and the rendered message.
	 * @returns Once every device was tried.
	 * @throws The first failure of a device that is not gone, after every device was tried.
	 */
	async send({ recipient, content }: NotificationDelivery<PushContent>): Promise<void> {
		// The target is the channel's to fill in: whatever of one the content carries is dropped, so a template can
		// neither redirect the message nor give it two targets
		const {
			subscription: _subscription,
			token: _token,
			platform: _platform,
			location: _location,
			...message
		} = content as PushMessage;

		let failure: unknown;

		// One message per device, since a message is one target in `@novastarter/push`
		for (const target of recipient.pushTargets ?? []) {
			try {
				await sendPush({ ...message, ...target });
			} catch (error) {
				// A gone device is forgotten even after another device failed; only the first failure is kept
				const judged = await judgeFailure(error, target, recipient.userId, options);

				failure ??= judged;
			}
		}

		// Thrown only once every device had its chance, so the job retries
		if (failure !== undefined) {
			throw failure;
		}
	},
});
