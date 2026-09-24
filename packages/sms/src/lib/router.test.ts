/**
 * Tests of `sms/lib/router`.
 */
import { describe, expect, test } from 'vitest';
import type { SmsDriver } from '../driver.js';
import type { SmsResult } from '../types.js';
import { resolveSmsChain } from './router.js';
import { SmsManager, type SmsRoutes } from './sms-manager.js';

// The null driver joins the driver map the way a driver package does, so its registrations type-check
declare module './sms-manager.js' {
	interface SmsDrivers {
		null: Record<string, never>;
	}
}

/**
 * A driver that sends nothing.
 */
class NullDriver implements SmsDriver {
	/**
	 * Answer nothing.
	 *
	 * @returns An empty result.
	 */
	async send(): Promise<SmsResult> {
		// The router only reads names; a driver that never delivers keeps the tests about routing.
		return {};
	}
}

/**
 * A manager with the given locations of the null driver.
 *
 * @param names - Location names.
 * @returns The manager.
 */
const managerWith = (...names: string[]): SmsManager => {
	// The chain is about names, not about transports, so one driver serves several locations.
	const manager = new SmsManager();

	manager.registerDriver('null', NullDriver);

	for (const name of names) {
		manager.registerLocation(name, {
			driver: 'null',
			options: {},
		});
	}

	return manager;
};

describe('resolveSmsChain', () => {
	/**
	 * Routes with one rule of each kind, the marketing chain carrying a name nobody registered.
	 */
	const routes: SmsRoutes = {
		transactional: ['main', 'backup'],
		marketing: ['bulk', 'typo'],
	};

	/**
	 * The locations the routes may name, `typo` left out on purpose.
	 */
	const manager = managerWith('main', 'backup', 'bulk');

	test('Routes by category, transactional unless said otherwise, dropping unknown names', () => {
		const message = { to: '+14155550123', text: 'Hi' };

		// No category means transactional; `typo` is not a location and silently leaves the marketing chain.
		expect(resolveSmsChain(routes, message, manager)).toStrictEqual(['main', 'backup']);
		expect(resolveSmsChain(routes, { ...message, category: 'marketing' }, manager)).toStrictEqual(['bulk']);
	});

	test('Passes a rule made only of unknown names over for every registered location', () => {
		const message = { to: '+14155550123', text: 'Hi', category: 'marketing' as const };

		// A category rule of typos is no rule, so registration order applies instead of an empty chain failing every
		// send.
		expect(resolveSmsChain({ marketing: ['blk'] }, message, manager)).toStrictEqual(['main', 'backup', 'bulk']);
	});

	test('Falls back to every location without routes, and to nothing without locations', () => {
		// With empty routes registration order is the chain, so one location needs no routes at all.
		expect(resolveSmsChain({}, { to: '+14155550123', text: 'x' }, manager)).toStrictEqual(['main', 'backup', 'bulk']);
		expect(resolveSmsChain({}, { to: '+14155550123', text: 'x' }, managerWith())).toStrictEqual([]);
	});
});
