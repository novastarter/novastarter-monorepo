import { InvalidPayloadError } from '@novastarter/errors';
import type { MailAddress } from '../types.js';

/**
 * Control characters that may never appear in a formatted address.
 *
 * CR and LF end the header line a formatted address becomes part of, so a value holding one would let the remainder
 * start a header of the attacker's choosing behind the real one; the other C0 controls and DEL are not printable
 * either. A tab is deliberately allowed — it only folds the line, which a quoted-string display name survives.
 */
// eslint-disable-next-line no-control-regex -- matching the control characters is exactly the point of the guard
const HEADER_UNSAFE_CHARACTERS = /[\x00-\x08\x0a-\x1f\x7f]/;

/**
 * Characters that may never appear in the address part of a `MailAddress` object.
 *
 * Mailgun, Postmark and Resend parse the formatted string as an RFC 5322 address list, so whitespace, a list separator
 * (`,` `;`), an angle bracket, a quote or a comment parenthesis in the address would let one object become several
 * recipients or a different angle-address. A single addr-spec never needs any of them.
 */
const ADDRESS_LIST_CHARACTERS = /[\s,;<>"()]/;

/**
 * Refuse an address part that would break the header line it is formatted into.
 *
 * @param value - The address or name to check.
 * @param what - Which part the value is, for the error message.
 * @throws InvalidPayloadError when the value holds CR, LF or another control character.
 */
const assertHeaderSafe = (value: string, what: string): void => {
	// CR or LF would end the header line and turn the rest into a header of its own; the other control characters are
	// not printable either — none of them belongs in an address
	if (HEADER_UNSAFE_CHARACTERS.test(value)) {
		throw new InvalidPayloadError({ reason: `${what} must not contain CR, LF or control characters` });
	}
};

/**
 * A `MailAddress` as one RFC 5322 string, the form most vendor APIs take.
 *
 * A display name that holds anything beyond letters, digits, spaces and `. ' - _` is wrapped in a quoted-string, with
 * `"` and `\` escaped, the way nodemailer does it: Mailgun, Postmark and Resend parse the string as an address list,
 * so an unquoted comma in a name would split one recipient into two broken ones. The name is trimmed first; one that
 * is empty afterwards — `''` or whitespace only — is dropped, so no stray space stands in front of the address.
 *
 * A CR, LF or other control character in the name, the address, or a pre-formatted string is refused with an
 * {@link InvalidPayloadError}: the result is one line of a header on the vendor APIs, and a line break inside it
 * would let the rest of the value forge a header of its own. The address of an object must also be a single addr-spec:
 * whitespace or any of `, ; < > " ( )` in it is refused, since the vendors would read those as a second recipient.
 *
 * @param address - Ours.
 * @returns `Name <address>`, `"Quoted, name" <address>`, or the bare address.
 * @throws InvalidPayloadError when a part holds CR, LF or another control character, or the address of an object holds
 * whitespace or a list or angle-address delimiter.
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
	// A string is handed on as given — but only within one header line: a line break or control character in it would
	// reach the provider's header verbatim, so it is refused before the string goes anywhere
	if (typeof address === 'string') {
		assertHeaderSafe(address, 'An address string');

		return address;
	}

	// Both parts are interpolated into one header line; CR or LF in either would end the line and let the rest forge a
	// header
	assertHeaderSafe(address.name, 'A mail address name');
	assertHeaderSafe(address.address, 'A mail address');

	// The address goes into the angle brackets unquoted, so a comma, bracket or the like in it would let one object
	// turn into several recipients on the vendors that parse an address list; a single addr-spec never holds them
	if (ADDRESS_LIST_CHARACTERS.test(address.address)) {
		throw new InvalidPayloadError({
			reason: 'A mail address must be a single addr-spec, without whitespace or , ; < > " ( )',
		});
	}

	// A name of nothing but whitespace formats as nothing at all; the bare address keeps the stray space out of the
	// line
	const trimmed = address.name.trim();

	if (trimmed === '') return address.address;

	// Only a name of plain characters may stand bare; RFC 5322 specials (`,` `<` `"` `@` and the like) and anything
	// non-ASCII go inside a quoted-string, where only the quote and the backslash need escaping
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
	if (typeof address !== 'string') return address.address;

	// A string may be a display-name form; the address is what the angle brackets hold
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
	if (typeof address !== 'string') {
		return { name: address.name, address: address.address };
	}

	// A display-name form splits at the angle brackets; a quoted name loses its quotes, with only `"` and `\`
	// unescaped, the characters RFC 5322 allows to be escaped there
	const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|([^<>]*?))\s*<([^<>\s]+)>\s*$/.exec(address);

	if (match) {
		const name = (match[1] !== undefined ? match[1].replace(/\\(["\\])/g, '$1') : (match[2] ?? '')).trim();

		return { ...(name !== '' ? { name } : {}), address: match[3]! };
	}

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
	// A single recipient is the common case; the list form spares every driver the same branch
	Array.isArray(to) ? to : [to];
