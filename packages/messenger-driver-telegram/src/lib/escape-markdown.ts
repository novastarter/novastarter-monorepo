/**
 * The characters `MarkdownV2` reserves: each has to be escaped with a backslash in plain text.
 *
 * @internal
 */
const RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape text for Telegram's `MarkdownV2`, so a value — a name, an amount, a URL — shows as typed instead of breaking
 * the markup or getting the message refused.
 *
 * Escape the values, not the template: `*${escapeMarkdownV2(name)}* paid` keeps the bold and shows the name as is.
 *
 * @param text - Plain text.
 * @returns The text with every reserved character escaped.
 * @example
 * ```ts
 * escapeMarkdownV2('Invoice #1042 (paid)'); // 'Invoice \\#1042 \\(paid\\)'
 * ```
 */
export const escapeMarkdownV2 = (text: string): string => {
	// 1. One backslash before each reserved character, the backslash itself included
	return text.replace(RESERVED, '\\$&');
};
