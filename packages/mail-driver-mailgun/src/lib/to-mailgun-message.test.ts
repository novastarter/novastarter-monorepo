/**
 * Tests of `to-mailgun-message`: how a message and its attachments become the form fields of Mailgun's
 * `messages.create()`.
 */
import { describe, expect, test } from 'vitest';
import {
	MAILGUN_TAG_COUNT,
	MAILGUN_TAG_LENGTH,
	type MailgunFile,
	toMailgunFile,
	toMailgunHeader,
	toMailgunMessage,
	toMailgunTags,
} from './to-mailgun-message.js';

/**
 * A file with its `Blob` read back into bytes and type, so a test can compare it by value.
 *
 * @param file - What the mapper built.
 * @returns The filename, the bytes, the `Blob` type and the content type, if any.
 */
const readFile = async (
	file: MailgunFile,
): Promise<{ filename: string; data: Buffer; type: string; contentType?: string }> => ({
	...file,
	// 1. A `Blob` has no own properties to compare, so its bytes and type are taken out
	data: Buffer.from(await file.data.arrayBuffer()),
	type: file.data.type,
});

describe('toMailgunTags', () => {
	test('Cuts every label to the length limit, drops an empty one and caps the count, the category first', () => {
		// 1. Mailgun refuses a message past its tag limits, so the labels are adapted instead: the category leads, an
		//    empty tag drops out and the tail past the count limit is left off
		expect(
			toMailgunTags({ to: 'a@b.c', subject: 'x', category: 'marketing', tags: ['', 'welcome', 'v2', 'extra'] }),
		).toStrictEqual(['marketing', 'welcome', 'v2', 'extra'].slice(0, MAILGUN_TAG_COUNT));

		// 2. A tag past the 128-character name limit is cut to its prefix, not refused
		expect(toMailgunTags({ to: 'a@b.c', subject: 'x', tags: ['x'.repeat(MAILGUN_TAG_LENGTH + 10)] })).toStrictEqual([
			'transactional',
			'x'.repeat(MAILGUN_TAG_LENGTH),
		]);

		// 3. A category alone fits, as does an empty tag list
		expect(toMailgunTags({ to: 'a@b.c', subject: 'x' })).toStrictEqual(['transactional']);
	});

	test('Brings a tag into Mailgun character set instead of refusing the message over it', () => {
		// 1. Mailgun takes ASCII letters, digits, `_` and `-` only, so a non-ASCII label becomes underscores rather
		//    than failing the whole send; the sanitised label is then cut and capped like any other
		expect(toMailgunTags({ to: 'a@b.c', subject: 'x', tags: ['счёт', 'v2.1'] })).toStrictEqual([
			'transactional',
			'____',
			'v2_1',
		]);
	});
});

describe('toMailgunHeader', () => {
	test('Passes a token name and a one-line value through as an `h:` field', () => {
		// 1. The common case: a header name of token characters, a value of one line — both reach the field as given
		expect(toMailgunHeader('X-Campaign', 'welcome')).toStrictEqual({ field: 'h:X-Campaign', value: 'welcome' });

		expect(toMailgunHeader('X-Trace_ID.v2', "a'$value`here")).toStrictEqual({
			field: 'h:X-Trace_ID.v2',
			value: "a'$value`here",
		});
	});

	test('Refuses a name that is no token, with a colon or whitespace in it', () => {
		// 1. A name holding a colon would make Mailgun's raw header name two headers; whitespace or a folded name is
		//    no single header either — the name has to be one RFC 7230 token
		expect(() => toMailgunHeader('X-Injected: Bcc', 'x')).toThrow(/cannot be sent/);
		expect(() => toMailgunHeader('X Bad', 'x')).toThrow(/cannot be sent/);
		expect(() => toMailgunHeader('X-Folded\r\nBcc', 'x')).toThrow(/cannot be sent/);
	});

	test('Refuses a value with CR or LF in it, which would forge a header line', () => {
		// 1. A line break in the value reaches Mailgun's raw header verbatim, so a value of more than one line is
		//    refused; the same goes for other control characters, a tab excepted
		expect(() => toMailgunHeader('X-Campaign', 'a\r\nBcc: attacker@evil.com')).toThrow(/cannot be sent/);
		expect(() => toMailgunHeader('X-Campaign', 'a\nBcc: attacker@evil.com')).toThrow(/cannot be sent/);
		expect(() => toMailgunHeader('X-Campaign', 'a\x00b')).toThrow(/cannot be sent/);
		expect(toMailgunHeader('X-Campaign', 'a\tb')).toStrictEqual({ field: 'h:X-Campaign', value: 'a\tb' });
	});
});

describe('toMailgunFile', () => {
	test('Keeps inline content and takes the content id as the filename', async () => {
		// 1. Mailgun matches `cid:` references by filename, so the content id stands in for it
		expect(
			await readFile(await toMailgunFile({ filename: 'logo.png', content: Buffer.from('png'), cid: 'logo' })),
		).toStrictEqual({ filename: 'logo', data: Buffer.from('png'), type: '' });
	});

	test('Carries the content type into the multipart part the SDK builds', async () => {
		// 1. The file the way the mapper builds an inline image named by a bare content id, so the filename gives
		//    Mailgun no type to guess
		const file = await toMailgunFile({
			filename: 'logo.png',
			content: Buffer.from('png'),
			contentType: 'image/png',
			cid: 'logo',
		});

		// 2. Append it the way mailgun.js does with Node's own FormData — a `Blob` goes in unchanged with the filename —
		//    and serialise the form to see the part's headers
		const form = new FormData();

		form.append('inline', file.data, file.filename);

		const body = await new Response(form).text();

		// 3. The part names the content id and carries the content type
		expect(body).toContain('filename="logo"');
		expect(body).toContain('Content-Type: image/png');
	});

	test('Reads a path', async () => {
		// 1. This very file is the attachment; a Buffer proves the path was read
		const file = await toMailgunFile({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(file.filename).toBe('self.ts');
		expect(file.data).toBeInstanceOf(Blob);
		expect(file.data.size).toBeGreaterThan(0);
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toMailgunFile({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toMailgunMessage', () => {
	test('Maps the message into Mailgun form fields, inline files apart', async () => {
		// 1. Headers become `h:` fields, tags `o:tag`; text content is read into bytes like every attachment
		const data = await toMailgunMessage(
			{
				to: [{ name: 'Ada', address: 'ada@example.com' }],
				cc: ['cc@example.com'],
				bcc: ['bcc@example.com'],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'Support <support@acme.test>',
				subject: 'Hi',
				html: '<p>Hi</p>',
				text: 'Hi',
				headers: { 'X-Campaign': 'welcome' },
				attachments: [
					{ filename: 'a.txt', content: 'hello', contentType: 'text/plain' },
					{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' },
				],
				category: 'marketing',
				tags: ['welcome', 'v2'],
			},
			true,
		);

		// 2. The files are typed `Blob`s, read back into bytes to compare the whole payload by value
		const { attachment, inline, ...fields } = data;

		expect(fields).toStrictEqual({
			from: 'Acme <no-reply@acme.test>',
			to: ['Ada <ada@example.com>'],
			cc: ['cc@example.com'],
			bcc: ['bcc@example.com'],
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			'o:tag': ['marketing', 'welcome', 'v2'],
			'o:testmode': true,
			'h:Reply-To': 'Support <support@acme.test>',
			'h:X-Campaign': 'welcome',
		});

		expect(await Promise.all((attachment as MailgunFile[]).map(readFile))).toStrictEqual([
			{ filename: 'a.txt', data: Buffer.from('hello'), type: 'text/plain', contentType: 'text/plain' },
		]);

		expect(await Promise.all((inline as MailgunFile[]).map(readFile))).toStrictEqual([
			{ filename: 'logo', data: Buffer.from('png'), type: 'image/png', contentType: 'image/png' },
		]);
	});

	test('Defaults the tag to the transactional category and leaves the optional fields out', async () => {
		// 1. Nothing optional given: nothing optional sent, the category is still a tag
		expect(
			await toMailgunMessage({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T' }),
		).toStrictEqual({
			from: 'me@acme.test',
			to: ['a@example.com'],
			subject: 'S',
			text: 'T',
			'o:tag': ['transactional'],
		});
	});

	test('Requires a sender', async () => {
		// 1. A message without a sender is refused by name
		await expect(toMailgunMessage({ to: 'a@example.com', subject: 'S' })).rejects.toThrow('"from"');
	});

	test('Refuses a custom header whose name is no token or whose value holds a line break', async () => {
		// 1. A forged header name or a value with CR/LF in it would reach Mailgun's raw headers verbatim, so the
		//    message is refused before the request goes out
		await expect(
			toMailgunMessage({
				to: 'a@example.com',
				from: 'me@acme.test',
				subject: 'S',
				headers: { 'X-Injected: Bcc': 'attacker@evil.com' },
			}),
		).rejects.toThrow(/cannot be sent/);

		await expect(
			toMailgunMessage({
				to: 'a@example.com',
				from: 'me@acme.test',
				subject: 'S',
				headers: { 'X-Campaign': 'welcome\r\nBcc: attacker@evil.com' },
			}),
		).rejects.toThrow(/cannot be sent/);
	});
});
