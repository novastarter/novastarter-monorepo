import type { MailAddress, MailCategory, MailMessage } from '../types.js';
import type { MailManager, MailRoutes } from './mail-manager.js';

/**
 * Domain of an address.
 *
 * @param address - Sender or recipient.
 * @returns What follows the `@`, lower-cased, without a closing bracket; `undefined` when there is none.
 * @example
 * ```ts
 * addressDomain('News <hello@News.Acme.com>');
 * // => 'news.acme.com'
 * ```
 */
export const addressDomain = (address: MailAddress): string | undefined => {
	// Only the address part carries a domain; a display name may hold anything
	const raw = typeof address === 'string' ? address : address.address;
	const at = raw.lastIndexOf('@');

	if (at === -1) return undefined;

	// A display-name form (`News <hello@news.acme.com>`) carries a closing bracket after the domain
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
 * are dropped, so a typo in a route degrades to the next location instead of failing every send: a rule whose names
 * are all unknown counts as no rule, and the next one applies.
 *
 * @param routes - The registered routes.
 * @param message - Message to route; `from` and `category` are read.
 * @param manager - Manager holding the locations.
 * @returns Location names to try, in order; empty when nothing is registered.
 * @example
 * ```ts
 * const chain = resolveMailChain(manager.routes(), message, manager);
 *
 * for (const location of chain) {
 * 	await manager.location(location).send(message);
 * }
 * ```
 */
export const resolveMailChain = (routes: MailRoutes, message: MailMessage, manager: MailManager): string[] => {
	const known = manager.locationNames();
	const category: MailCategory = message.category ?? 'transactional';

	// A rule is judged on the locations it can reach: unknown names are dropped before the rule is chosen, so a rule
	// made only of typos never wins the selection with an empty chain
	const usable = (names: string[] | undefined): string[] => (names ?? []).filter((name) => known.includes(name));

	// The sender's domain is the most specific rule
	const domain = message.from ? addressDomain(message.from) : undefined;
	const byDomain = usable(domain ? routes.domains?.[domain] : undefined);

	if (byDomain.length) return byDomain;

	const byCategory = usable(routes[category]);

	return byCategory.length ? byCategory : known;
};
