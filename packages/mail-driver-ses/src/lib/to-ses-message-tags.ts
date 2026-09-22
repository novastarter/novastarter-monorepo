import type { MessageTag } from '@aws-sdk/client-sesv2';
import type { MailMessage } from '@novastarter/mail';

/**
 * Longest message tag name or value SES accepts; a longer one fails the whole request with a `BadRequestException`.
 *
 * @defaultValue 256 characters.
 */
export const SES_MESSAGE_TAG_LENGTH = 256;

/**
 * A tag name or value the way SES accepts it: ASCII letters, digits, underscores and dashes, at most
 * {@link SES_MESSAGE_TAG_LENGTH} characters.
 *
 * @param value - Free text.
 * @returns The sanitised text, anything else replaced by `_` and the tail past the limit cut off; empty for empty
 * input.
 */
export const toSesMessageTag = (value: string): string =>
	value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, SES_MESSAGE_TAG_LENGTH);

/**
 * The SES message tags of a message: the category as `category=<category>`, every tag as `<tag>=1`.
 *
 * SES matches every name and value against `^[a-zA-Z0-9_-]{1,256}$` and refuses the whole message over one miss, so
 * a tag that every other provider takes as given must not fail the send here: names and values are sanitised with
 * {@link toSesMessageTag}, and a tag left with no name is dropped.
 *
 * @param message - Ours.
 * @returns SES's `EmailTags`.
 */
export const toSesMessageTags = (message: MailMessage): MessageTag[] => {
	// 1. The category is always recorded; its value goes through the sanitiser too, since at runtime it is any string
	const tags: MessageTag[] = [{ Name: 'category', Value: toSesMessageTag(message.category ?? 'transactional') }];

	// 2. A tag that sanitises to nothing has no name SES would take; dropping it keeps the rest of the message sending
	for (const tag of message.tags ?? []) {
		const name = toSesMessageTag(tag);

		if (name) {
			tags.push({ Name: name, Value: '1' });
		}
	}

	return tags;
};
