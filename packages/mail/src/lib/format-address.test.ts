/**
 * Tests of `mail/lib/format-address`: the address forms the vendor drivers hand to their APIs.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { bareMailAddress, formatMailAddress, parseMailAddress, toMailAddressList } from './format-address.js';

describe('formatMailAddress', () => {
	test('Hands a string on as given and joins a plain name with its address', () => {
		// 1. A string is the caller's own formatting; a plain name needs no quoting
		expect(formatMailAddress('ada@example.com')).toBe('ada@example.com');
		expect(formatMailAddress('Ada <ada@example.com>')).toBe('Ada <ada@example.com>');

		expect(formatMailAddress({ name: 'Ada Lovelace', address: 'ada@example.com' })).toBe(
			'Ada Lovelace <ada@example.com>',
		);

		expect(formatMailAddress({ name: "J. O'Neil-Smith", address: 'j@example.com' })).toBe(
			"J. O'Neil-Smith <j@example.com>",
		);
	});

	test('Quotes a name holding RFC 5322 specials, escaping quotes and backslashes', () => {
		// 1. A comma would split the recipient in two on Mailgun, Postmark and Resend; the quoted-string keeps it whole
		expect(formatMailAddress({ name: 'Smith, John', address: 'john@example.com' })).toBe(
			'"Smith, John" <john@example.com>',
		);

		// 2. Angle brackets and `@` in a name would be read as a second address
		expect(formatMailAddress({ name: 'Ada <admin>', address: 'ada@example.com' })).toBe(
			'"Ada <admin>" <ada@example.com>',
		);

		expect(formatMailAddress({ name: 'ada@acme', address: 'ada@example.com' })).toBe('"ada@acme" <ada@example.com>');

		// 3. Inside the quotes only `"` and `\` need an escape
		expect(formatMailAddress({ name: 'Ada "The Countess" \\ Co', address: 'ada@example.com' })).toBe(
			'"Ada \\"The Countess\\" \\\\ Co" <ada@example.com>',
		);

		// 4. A non-ASCII name is quoted as well, which the JSON APIs take as UTF-8
		expect(formatMailAddress({ name: 'Jürgen Müller', address: 'j@example.de' })).toBe(
			'"Jürgen Müller" <j@example.de>',
		);
	});

	test('Drops a name that is empty or whitespace only, keeping the bare address', () => {
		// 1. An empty name has nothing to display; a whitespace-only one neither — both would leave a stray space in
		//    front of the address
		expect(formatMailAddress({ name: '', address: 'ada@example.com' })).toBe('ada@example.com');
		expect(formatMailAddress({ name: '   ', address: 'ada@example.com' })).toBe('ada@example.com');

		// 2. Surrounding whitespace of a real name is trimmed, not carried into the line
		expect(formatMailAddress({ name: '  Ada  ', address: 'ada@example.com' })).toBe('Ada <ada@example.com>');
	});

	test('Refuses CR, LF and control characters in the name, the address and a pre-formatted string', () => {
		// 1. CR or LF in the address would end the header line and start a forged one on the vendor APIs, so the
		//    address is refused instead of being interpolated verbatim
		expect(() => formatMailAddress({ name: 'Acme', address: 'a@b.com>\r\nBcc: attacker@evil.com <x' })).toThrow(
			/address must not contain CR, LF or control characters/,
		);

		// 2. The same goes for the name, quoted or not, and for a pre-formatted string handed on as given
		expect(() => formatMailAddress({ name: 'A\r\nBcc: attacker@evil.com', address: 'a@b.com' })).toThrow(
			/name must not contain CR, LF or control characters/,
		);

		expect(() => formatMailAddress('a@b.com>\r\nBcc: attacker@evil.com <x')).toThrow(
			/address string must not contain CR, LF or control characters/,
		);

		// 3. Other control characters — a NUL, an ESC — are refused just the same; a tab is not a line break and stays
		expect(() => formatMailAddress({ name: 'A\x00B', address: 'a@b.com' })).toThrow(InvalidPayloadError);
		expect(() => formatMailAddress({ name: 'A\x1bB', address: 'a@b.com' })).toThrow(InvalidPayloadError);
		expect(formatMailAddress({ name: 'A\tB', address: 'a@b.com' })).toBe('"A\tB" <a@b.com>');
	});
});

describe('bareMailAddress', () => {
	test('Reads the address out of every form', () => {
		// 1. An object keeps the parts apart; a bare string is its own address
		expect(bareMailAddress({ name: 'Ada', address: 'ada@example.com' })).toBe('ada@example.com');
		expect(bareMailAddress('ada@example.com')).toBe('ada@example.com');

		// 2. A display-name form is unwrapped, whatever the name holds and with trailing whitespace tolerated
		expect(bareMailAddress('Ada <ada@example.com>')).toBe('ada@example.com');
		expect(bareMailAddress('"Smith, John" <john@example.com>  ')).toBe('john@example.com');
	});
});

describe('parseMailAddress', () => {
	test('Splits a display-name string into its two parts and keeps an object as is', () => {
		// 1. A name in front of the angle brackets survives, so object-based APIs see what nodemailer-based ones do
		expect(parseMailAddress('Ada <ada@example.com>')).toStrictEqual({ name: 'Ada', address: 'ada@example.com' });

		expect(parseMailAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			name: 'Ada',
			address: 'ada@example.com',
		});

		// 2. A bare string is its own address, with no name to carry
		expect(parseMailAddress('ada@example.com')).toStrictEqual({ address: 'ada@example.com' });
	});

	test('Takes a quoted name with its escapes and brackets unwrapped', () => {
		// 1. The quoted-string's quotes come off, with only the escaped quote and backslash unescaped, as RFC 5322 has it
		expect(parseMailAddress('"Smith, John" <john@example.com>')).toStrictEqual({
			name: 'Smith, John',
			address: 'john@example.com',
		});

		expect(parseMailAddress('"Ada \\"The Countess\\" \\\\ Co" <ada@example.com>')).toStrictEqual({
			name: 'Ada "The Countess" \\ Co',
			address: 'ada@example.com',
		});

		// 2. A nameless bracketed form is the address alone
		expect(parseMailAddress('<ada@example.com>')).toStrictEqual({ address: 'ada@example.com' });
	});
});

describe('toMailAddressList', () => {
	test('Wraps a single recipient and keeps a list as it is', () => {
		// 1. Same list object back, so callers may map it without copying twice
		const list = ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }];

		expect(toMailAddressList('ada@example.com')).toStrictEqual(['ada@example.com']);
		expect(toMailAddressList(list)).toBe(list);
	});
});
