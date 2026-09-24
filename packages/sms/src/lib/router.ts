import type { SmsCategory, SmsMessage } from '../types.js';
import type { SmsManager, SmsRoutes } from './sms-manager.js';

/**
 * The locations to try for a message, in order.
 *
 * The route by category applies; without one, every registered location in registration order is the chain — so a
 * single location needs no routes at all. Names the manager does not know are dropped, so a typo in a route degrades
 * to the next location instead of failing every send: a rule whose names are all unknown counts as no rule, and the
 * fallback applies.
 *
 * @param routes - The registered routes.
 * @param message - Message to route; `category` is read.
 * @param manager - Manager holding the locations.
 * @returns Location names to try, in order; empty when nothing is registered.
 * @example
 * ```ts
 * const chain = resolveSmsChain(manager.routes(), message, manager);
 *
 * for (const location of chain) {
 * 	await manager.location(location).send(message);
 * }
 * ```
 */
export const resolveSmsChain = (routes: SmsRoutes, message: SmsMessage, manager: SmsManager): string[] => {
	const known = manager.locationNames();
	const category: SmsCategory = message.category ?? 'transactional';

	// Unknown names are dropped before the rule is chosen, so a rule made only of typos never wins the selection with
	// an empty chain.
	const byCategory = (routes[category] ?? []).filter((name) => known.includes(name));

	return byCategory.length ? byCategory : known;
};
