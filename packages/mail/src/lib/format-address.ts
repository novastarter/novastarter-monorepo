import type { MailAddress } from '../types.js';

/**
 * A `MailAddress` as one RFC 5322 string, the form most vendor APIs take.
 *
 * @param address - Ours.
 * @returns `Name <address>`, or the bare address.
 */
export const formatMailAddress = (address: MailAddress): string =>
	typeof address === 'string' ? address : `${address.name} <${address.address}>`;

/**
 * Only the address part of a `MailAddress`.
 *
 * @param address - Ours.
 * @returns The bare address, a display-name form (`Name <addr>`) unwrapped.
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
 */
export const toMailAddressList = (to: MailAddress | MailAddress[]): MailAddress[] => (Array.isArray(to) ? to : [to]);
