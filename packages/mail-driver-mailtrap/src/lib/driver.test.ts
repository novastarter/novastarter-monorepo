/**
 * Tests of the Mailtrap driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, { MailDriverMailtrap, toMailtrapAddress, toMailtrapAttachment, toMailtrapMail } from './index.js';

const send = vi.fn();
const getAllAccounts = vi.fn();
const construct = vi.fn();

vi.mock('mailtrap', () => ({
	MailtrapClient: class {
		send = send;

		general = { accounts: { getAllAccounts } };

		constructor(options: unknown) {
			construct(options);
		}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('toMailtrapAddress', () => {
	test('Splits a name from an address and strips a formatted string', () => {
		// 1. An object keeps its name; a display-name string is reduced to the address
		expect(toMailtrapAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			email: 'ada@example.com',
			name: 'Ada',
		});

		expect(toMailtrapAddress('Ada <ada@example.com>')).toStrictEqual({ email: 'ada@example.com' });
	});
});

describe('toMailtrapAttachment', () => {
	test('Marks an attachment with a content id as inline', async () => {
		// 1. The SDK takes the Buffer as is; the content id sets the disposition
		expect(
			await toMailtrapAttachment({
				filename: 'logo.png',
				content: Buffer.from('png'),
				contentType: 'image/png',
				cid: 'logo',
			}),
		).toStrictEqual({
			filename: 'logo.png',
			content: Buffer.from('png'),
			disposition: 'inline',
			type: 'image/png',
			content_id: 'logo',
		});
	});

	test('Reads a path', async () => {
		// 1. This very file is the attachment; a Buffer proves the path was read
		const attachment = await toMailtrapAttachment({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(attachment.disposition).toBe('attachment');
		expect(Buffer.isBuffer(attachment.content)).toBe(true);
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toMailtrapAttachment({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toMailtrapMail', () => {
	test('Maps the message into Mailtrap shape with the tags as a custom variable', async () => {
		// 1. Every field finds its Mailtrap name; text content is read into a Buffer like every attachment
		expect(
			await toMailtrapMail({
				to: [{ name: 'Ada', address: 'ada@example.com' }],
				cc: ['cc@example.com'],
				bcc: ['bcc@example.com'],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'Support <support@acme.test>',
				subject: 'Hi',
				html: '<p>Hi</p>',
				text: 'Hi',
				headers: { 'X-Campaign': 'welcome' },
				attachments: [{ filename: 'a.txt', content: 'hello', contentType: 'text/plain' }],
				category: 'marketing',
				tags: ['welcome', 'v2'],
			}),
		).toStrictEqual({
			from: { email: 'no-reply@acme.test', name: 'Acme' },
			to: [{ email: 'ada@example.com', name: 'Ada' }],
			cc: [{ email: 'cc@example.com' }],
			bcc: [{ email: 'bcc@example.com' }],
			reply_to: { email: 'support@acme.test' },
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			category: 'marketing',
			headers: { 'X-Campaign': 'welcome' },
			custom_variables: { tags: 'welcome,v2' },
			attachments: [
				{ filename: 'a.txt', content: Buffer.from('hello'), disposition: 'attachment', type: 'text/plain' },
			],
		});
	});

	test('Defaults the category and leaves the optional fields out', async () => {
		// 1. Nothing optional given: nothing optional sent
		expect(await toMailtrapMail({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T' })).toStrictEqual({
			from: { email: 'me@acme.test' },
			to: [{ email: 'a@example.com' }],
			subject: 'S',
			text: 'T',
			category: 'transactional',
		});
	});

	test('Requires a sender', async () => {
		// 1. A message without a sender is refused by name
		await expect(toMailtrapMail({ to: 'a@example.com', subject: 'S' })).rejects.toThrow('"from"');
	});
});

describe('MailDriverMailtrap', () => {
	test('Requires the token, an inbox in sandbox mode, and not both sandbox and bulk', () => {
		// 1. Every configuration error is reported by the option's name, before the SDK gets to refuse a send
		expect(() => new MailDriverMailtrap({ token: '' })).toThrow('"token"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true })).toThrow('"testInboxId"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 1, bulk: true })).toThrow('at once');
		expect(defaultExport).toBe(MailDriverMailtrap);
	});

	test('Builds the client for sending, the sandbox and the bulk stream', () => {
		// 1. Plain sending: both flags off
		new MailDriverMailtrap({ token: 't' });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: false });

		// 2. Sandbox: the inbox goes along
		new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 123 });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: true, bulk: false, testInboxId: 123 });

		// 3. Bulk stream
		new MailDriverMailtrap({ token: 't', bulk: true });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: true });
	});

	test('Sends and maps the result', async () => {
		// 1. Mailtrap answers a list of message ids; the first one is the message's
		send.mockResolvedValueOnce({ success: true, message_ids: ['0c7fd939-02cf-11ed-88c2-0a58a9feac02'] });

		const driver = new MailDriverMailtrap({ token: 't' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		// 2. Recipients went out as address objects
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ to: [{ email: 'ada@example.com' }, { email: 'bob@example.com' }], subject: 'S' }),
		);

		// 3. Every recipient counts as accepted
		expect(result).toStrictEqual({
			messageId: '0c7fd939-02cf-11ed-88c2-0a58a9feac02',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
		});
	});

	test('Lets a refusal of the API through', async () => {
		// 1. The SDK's error passes through untouched
		send.mockRejectedValueOnce(new Error("'to' address is required"));

		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toThrow(
			"'to' address is required",
		);
	});

	test('Verifies by listing the accounts of the token', async () => {
		const driver = new MailDriverMailtrap({ token: 't' });

		// 1. At least one account means the token can send
		getAllAccounts.mockResolvedValueOnce([{ id: 1, name: 'Acme' }]);
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. None means it cannot, even though Mailtrap answered
		getAllAccounts.mockResolvedValueOnce([]);
		await expect(driver.verify()).rejects.toThrow('no account');

		// 3. A refusal passes through
		getAllAccounts.mockRejectedValueOnce(new Error('Unauthorized'));
		await expect(driver.verify()).rejects.toThrow('Unauthorized');
	});
});
