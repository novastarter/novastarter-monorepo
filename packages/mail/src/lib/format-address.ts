import type { MailAddress } from '../types.js';

/**
 * A `MailAddress` as one RFC 5322 string, the form most vendor APIs take.
 *
 * A display name that holds anything beyond letters, digits, spaces and `. ' - _` is wrapped in a quoted-string, with
 * `"` and `\` escaped, the way nodemailer does it: Mailgun, Postmark and Resend parse the string as an address list,
 * so an unquoted comma in a name would split one recipient into two broken ones.
 *
 * @param address - Ours.
 * @returns `Name <address>`, `"Quoted, name" <address>`, or the bare address.
 * @example
 * ```ts
 * formatMailAddress({ name: 'Ada', address: 'ada@example.com' });
 * // => 'Ada <ada@example.com>'
 *
 * formatMailAddress({ name: 'Smith, John', address: 'john@example.com' });
 * // => '"Smith, John" <john@example.com>'
 * ```
 */
export const formatMailAddress = (address: MailAddress): string => {
	// 1. A string is handed on as given: the caller already formatted it
	if (typeof address === 'string') return address;

	// 2. Only a name of plain characters may stand bare; RFC 5322 specials (`,` `<` `"` `@` and the like) and anything
	//    non-ASCII go inside a quoted-string, where only the quote and the backslash need escaping
	const name = /[^\w .'-]/.test(address.name) ? `"${address.name.replace(/["\\]/g, '\\$&')}"` : address.name;

	return `${name} <${address.address}>`;
};

/**
 * Only the address part of a `MailAddress`.
 *
 * @param address - Ours.
 * @returns The bare address, a display-name form (`Name <addr>`) unwrapped.
 * @example
 * ```ts
 * bareMailAddress('Ada <ada@example.com>');
 * // => 'ada@example.com'
 *
 * bareMailAddress({ name: 'Ada', address: 'ada@example.com' });
 * // => 'ada@example.com'
 * ```
 */
export const bareMailAddress = (address: MailAddress): string => {
	// 1. An object already keeps the parts apart
	if (typeof address !== 'string') return address.address;

	// 2. A string may be a display-name form; the address is what the angle brackets hold
	const match = /<([^>]+)>\s*$/.exec(address);

	return match ? match[1]! : address;
};

/**
 * The recipients of a message as a flat list.
 *
 * @param to - `to` of a message.
 * @returns Every recipient.
 * @example
 * ```ts
 * toMailAddressList('ada@example.com');
 * // => ['ada@example.com']
 *
 * toMailAddressList(message.to).map(formatMailAddress);
 * ```
 */
export const toMailAddressList = (to: MailAddress | MailAddress[]): MailAddress[] =>
	// 1. A single recipient is the common case; the list form spares every driver the same branch
	Array.isArray(to) ? to : [to];
