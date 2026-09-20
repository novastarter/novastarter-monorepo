import type { MailAddress, MailCategory, MailMessage } from '../types.js';
import type { MailManager, MailRoutes } from './mail-manager.js';

/**
 * Domain of an address.
 *
 * @param address - Sender or recipient.
 * @returns What follows the `@`, lower-cased, without a closing bracket; `undefined` when there is none.
 */
export const addressDomain = (address: MailAddress): string | undefined => {
	// 1. Only the address part carries a domain; a display name may hold anything
	const raw = typeof address === 'string' ? address : address.address;
	const at = raw.lastIndexOf('@');

	if (at === -1) return undefined;

	// 2. A display-name form (`News <hello@news.acme.com>`) carries a closing bracket after the domain
	return raw
		.slice(at + 1)
		.replace(/[>\s]+$/, '')
		.toLowerCase();
};

/**
 * The locations to try for a message, in order.
 *
 * A route by the sender's domain wins over the route by category; without either, every registered location in
 * registration order is the chain — so a single location needs no routes at all. Names the manager does not know
 * are dropped, so a typo in a route degrades to the next location instead of failing every send.
 *
 * @param routes - The registered routes.
 * @param message - Message to route; `from` and `category` are read.
 * @param manager - Manager holding the locations.
 * @returns Location names to try, in order; empty when nothing is registered.
 */
export const resolveMailChain = (routes: MailRoutes, message: MailMessage, manager: MailManager): string[] => {
	const known = manager.locationNames();
	const category: MailCategory = message.category ?? 'transactional';

	// 1. The sender's domain is the most specific rule
	const domain = message.from ? addressDomain(message.from) : undefined;
	const byDomain = domain ? routes.domains?.[domain] : undefined;
	const byCategory = routes[category];

	// 2. Then the category, then everything
	let chain = known;

	if (byDomain?.length) {
		chain = byDomain;
	} else if (byCategory?.length) {
		chain = byCategory;
	}

	// 3. Unknown names are dropped rather than thrown on, so one bad route never blocks the whole chain
	return chain.filter((name) => known.includes(name));
};
