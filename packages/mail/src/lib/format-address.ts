import type { MailAddress } from '../types.js';

/**
 * A `MailAddress` as one RFC 5322 string, the form most vendor APIs take.
 *
 * A display name that holds anything beyond letters, digits, spaces and `. ' - _` is wrapped in a quoted-string, with
 * `"` and `\` escaped, the way nodemailer does it: Mailgun, Postmark and Resend parse the string as an address list,
 * so an unquoted comma in a name would split one recipient into two broken ones. The name is trimmed first; one that
 * is empty afterwards — `''` or whitespace only — is dropped, so no stray space stands in front of the address.
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

	// 2. A name of nothing but whitespace formats as nothing at all; the bare address keeps the stray space out of
	//    the line
	const trimmed = address.name.trim();

	if (trimmed === '') return address.address;

	// 3. Only a name of plain characters may stand bare; RFC 5322 specials (`,` `<` `"` `@` and the like) and
	//    anything non-ASCII go inside a quoted-string, where only the quote and the backslash need escaping
	const name = /[^\w .'-]/.test(trimmed) ? `"${trimmed.replace(/["\\]/g, '\\$&')}"` : trimmed;

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
 * A `MailAddress` as its two parts: the address always, the display name when there is one.
 *
 * A display-name string (`Ada <ada@example.com>`, or a quoted `"Smith, John" <john@example.com>`) is split into its
 * name and address, the quoted-string's quotes and escapes coming off; a bare string is its own address with no name.
 * Drivers whose API takes `{ email, name }` objects (Mailjet, Mailtrap, SendGrid) use this so a name given as a
 * string survives, the way the nodemailer-based drivers keep it.
 *
 * @param address - Ours.
 * @returns The address, with the display name when there is one.
 * @example
 * ```ts
 * parseMailAddress('Ada <ada@example.com>');
 * // => { name: 'Ada', address: 'ada@example.com' }
 *
 * parseMailAddress('ada@example.com');
 * // => { address: 'ada@example.com' }
 * ```
 */
export const parseMailAddress = (address: MailAddress): { name?: string | undefined; address: string } => {
	// 1. An object already keeps the parts apart
	if (typeof address !== 'string') {
		return { name: address.name, address: address.address };
	}

	// 2. A display-name form splits at the angle brackets; a quoted name loses its quotes, with only `"` and `\`
	//    unescaped, the characters RFC 5322 allows to be escaped there
	const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|([^<>]*?))\s*<([^<>\s]+)>\s*$/.exec(address);

	if (match) {
		const name = (match[1] !== undefined ? match[1].replace(/\\(["\\])/g, '$1') : (match[2] ?? '')).trim();

		return { ...(name !== '' ? { name } : {}), address: match[3]! };
	}

	// 3. A bare string is its own address, with no name to carry
	return { address };
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
