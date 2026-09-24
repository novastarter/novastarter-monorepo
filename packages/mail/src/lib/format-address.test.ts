/**
 * Tests of `mail/lib/format-address`: the address forms the vendor drivers hand to their APIs.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { bareMailAddress, formatMailAddress, parseMailAddress, toMailAddressList } from './format-address.js';

describe('formatMailAddress', () => {
	test('Hands a string on as given and joins a plain name with its address', () => {
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
		// A comma would split the recipient in two on Mailgun, Postmark and Resend; the quoted-string keeps it whole
		expect(formatMailAddress({ name: 'Smith, John', address: 'john@example.com' })).toBe(
			'"Smith, John" <john@example.com>',
		);

		// Angle brackets and `@` in a name would be read as a second address
		expect(formatMailAddress({ name: 'Ada <admin>', address: 'ada@example.com' })).toBe(
			'"Ada <admin>" <ada@example.com>',
		);

		expect(formatMailAddress({ name: 'ada@acme', address: 'ada@example.com' })).toBe('"ada@acme" <ada@example.com>');

		// Inside the quotes only `"` and `\` need an escape
		expect(formatMailAddress({ name: 'Ada "The Countess" \\ Co', address: 'ada@example.com' })).toBe(
			'"Ada \\"The Countess\\" \\\\ Co" <ada@example.com>',
		);

		// A non-ASCII name is quoted as well, which the JSON APIs take as UTF-8
		expect(formatMailAddress({ name: 'Jürgen Müller', address: 'j@example.de' })).toBe(
			'"Jürgen Müller" <j@example.de>',
		);
	});

	test('Drops a name that is empty or whitespace only, keeping the bare address', () => {
		// An empty name has nothing to display; a whitespace-only one neither — both would leave a stray space in front
		// of the address
		expect(formatMailAddress({ name: '', address: 'ada@example.com' })).toBe('ada@example.com');
		expect(formatMailAddress({ name: '   ', address: 'ada@example.com' })).toBe('ada@example.com');

		expect(formatMailAddress({ name: '  Ada  ', address: 'ada@example.com' })).toBe('Ada <ada@example.com>');
	});

	test('Refuses CR, LF and control characters in the name, the address and a pre-formatted string', () => {
		// CR or LF in the address would end the header line and start a forged one on the vendor APIs, so the address
		// is refused instead of being interpolated verbatim
		expect(() => formatMailAddress({ name: 'Acme', address: 'a@b.com>\r\nBcc: attacker@evil.com <x' })).toThrow(
			/address must not contain CR, LF or control characters/,
		);

		expect(() => formatMailAddress({ name: 'A\r\nBcc: attacker@evil.com', address: 'a@b.com' })).toThrow(
			/name must not contain CR, LF or control characters/,
		);

		expect(() => formatMailAddress('a@b.com>\r\nBcc: attacker@evil.com <x')).toThrow(
			/address string must not contain CR, LF or control characters/,
		);

		expect(() => formatMailAddress({ name: 'A\x00B', address: 'a@b.com' })).toThrow(InvalidPayloadError);
		expect(() => formatMailAddress({ name: 'A\x1bB', address: 'a@b.com' })).toThrow(InvalidPayloadError);
		expect(formatMailAddress({ name: 'A\tB', address: 'a@b.com' })).toBe('"A\tB" <a@b.com>');
	});

	test('Refuses an object address holding whitespace or a list or angle-address delimiter', () => {
		// A closing bracket and a comma would turn one recipient into several on the vendors that parse a list
		expect(() => formatMailAddress({ name: 'A', address: 'v@x.com>, e@evil.com' })).toThrow(
			/must be a single addr-spec/,
		);

		expect(() => formatMailAddress({ name: '', address: 'v@x.com, e@evil.com' })).toThrow(InvalidPayloadError);

		for (const bad of ['v@x.com;e@evil.com', 'v@x.com e@evil.com', '<v@x.com>', '"v"@x.com', 'v(c)@x.com']) {
			expect(() => formatMailAddress({ name: 'A', address: bad })).toThrow(InvalidPayloadError);
		}
	});
});

describe('bareMailAddress', () => {
	test('Reads the address out of every form', () => {
		expect(bareMailAddress({ name: 'Ada', address: 'ada@example.com' })).toBe('ada@example.com');
		expect(bareMailAddress('ada@example.com')).toBe('ada@example.com');

		expect(bareMailAddress('Ada <ada@example.com>')).toBe('ada@example.com');
		expect(bareMailAddress('"Smith, John" <john@example.com>  ')).toBe('john@example.com');
	});
});

describe('parseMailAddress', () => {
	test('Splits a display-name string into its two parts and keeps an object as is', () => {
		// A name in front of the angle brackets survives, so object-based APIs see what nodemailer-based ones do
		expect(parseMailAddress('Ada <ada@example.com>')).toStrictEqual({ name: 'Ada', address: 'ada@example.com' });

		expect(parseMailAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			name: 'Ada',
			address: 'ada@example.com',
		});

		expect(parseMailAddress('ada@example.com')).toStrictEqual({ address: 'ada@example.com' });
	});

	test('Takes a quoted name with its escapes and brackets unwrapped', () => {
		// The quoted-string's quotes come off, with only the escaped quote and backslash unescaped, as RFC 5322 has it
		expect(parseMailAddress('"Smith, John" <john@example.com>')).toStrictEqual({
			name: 'Smith, John',
			address: 'john@example.com',
		});

		expect(parseMailAddress('"Ada \\"The Countess\\" \\\\ Co" <ada@example.com>')).toStrictEqual({
			name: 'Ada "The Countess" \\ Co',
			address: 'ada@example.com',
		});

		expect(parseMailAddress('<ada@example.com>')).toStrictEqual({ address: 'ada@example.com' });
	});
});

describe('toMailAddressList', () => {
	test('Wraps a single recipient and keeps a list as it is', () => {
		// Same list object back, so callers may map it without copying twice
		const list = ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }];

		expect(toMailAddressList('ada@example.com')).toStrictEqual(['ada@example.com']);
		expect(toMailAddressList(list)).toBe(list);
	});
});
