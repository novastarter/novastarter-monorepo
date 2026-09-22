/**
 * Tests of `mail/lib/router`.
 */
import { describe, expect, test } from 'vitest';
import type { MailDriver } from '../driver.js';
import { MailManager, type MailRoutes } from './mail-manager.js';
import { addressDomain, resolveMailChain } from './router.js';

// The null driver joins the driver map the way a driver package does, so its registrations type-check
declare module './mail-manager.js' {
	interface MailDrivers {
		null: Record<string, never>;
	}
}

/**
 * A driver that sends nothing.
 */
class NullDriver implements MailDriver {
	/**
	 * Accept nobody, reject nobody.
	 *
	 * @returns Empty lists.
	 */
	async send(): Promise<{ accepted: string[]; rejected: string[] }> {
		// 1. The router only reads names; a driver that never delivers keeps the tests about routing
		return { accepted: [], rejected: [] };
	}
}

/**
 * A manager with the given locations of the null driver.
 *
 * @param names - Location names.
 * @returns The manager.
 */
const managerWith = (...names: string[]): MailManager => {
	// 1. One driver, several locations: the chain is about names, not about transports
	const manager = new MailManager();

	manager.registerDriver('null', NullDriver);

	for (const name of names) {
		manager.registerLocation(name, {
			driver: 'null',
			options: {},
		});
	}

	return manager;
};

describe('addressDomain', () => {
	test('Reads the domain of every address form', () => {
		// 1. Lower-cased and unwrapped whatever the form; no `@` means no domain
		expect(addressDomain('Ada@News.Acme.com')).toBe('news.acme.com');
		expect(addressDomain('News <hello@news.acme.com>')).toBe('news.acme.com');
		expect(addressDomain({ name: 'Ada', address: 'ada@acme-mail.io' })).toBe('acme-mail.io');
		expect(addressDomain('nope')).toBeUndefined();
	});
});

describe('resolveMailChain', () => {
	/**
	 * Routes with one rule of each kind, the marketing chain carrying a name nobody registered.
	 */
	const routes: MailRoutes = {
		transactional: ['main', 'backup'],
		marketing: ['bulk', 'typo'],
		domains: {
			'news.acme.com': ['bulk'],
		},
	};

	/**
	 * The locations the routes may name, `typo` left out on purpose.
	 */
	const manager = managerWith('main', 'backup', 'bulk');

	test('Routes by category, transactional unless said otherwise, dropping unknown names', () => {
		const message = { to: 'ada@example.com', subject: 'Hi' };

		// 1. No category means transactional; `typo` is not a location and silently leaves the marketing chain
		expect(resolveMailChain(routes, message, manager)).toStrictEqual(['main', 'backup']);
		expect(resolveMailChain(routes, { ...message, category: 'marketing' }, manager)).toStrictEqual(['bulk']);
	});

	test('Lets the sender domain win over the category', () => {
		const message = { to: 'ada@example.com', from: 'News <hello@news.acme.com>', subject: 'Hi' };

		// 1. The domain rule is matched on the lower-cased domain, whatever the address form
		expect(resolveMailChain(routes, message, manager)).toStrictEqual(['bulk']);
		expect(resolveMailChain(routes, { ...message, from: 'hello@acme.com' }, manager)).toStrictEqual(['main', 'backup']);
	});

	test('Passes a rule made only of unknown names over for the next one', () => {
		const message = {
			to: 'ada@example.com',
			from: 'News <hello@news.acme.com>',
			subject: 'Hi',
			category: 'marketing' as const,
		};

		// 1. A domain rule of typos is no rule: the category chain applies instead of an empty one failing every send
		expect(resolveMailChain({ ...routes, domains: { 'news.acme.com': ['blk'] } }, message, manager)).toStrictEqual([
			'bulk',
		]);

		// 2. The category rule degrades the same way, down to every registered location
		expect(resolveMailChain({ marketing: ['blk'] }, message, manager)).toStrictEqual(['main', 'backup', 'bulk']);
	});

	test('Falls back to every location without routes, and to nothing without locations', () => {
		// 1. Empty routes: registration order is the chain, so one location needs no routes at all
		expect(resolveMailChain({}, { to: 'a@b.c', subject: 'x' }, manager)).toStrictEqual(['main', 'backup', 'bulk']);
		expect(resolveMailChain({}, { to: 'a@b.c', subject: 'x' }, managerWith())).toStrictEqual([]);
	});
});
