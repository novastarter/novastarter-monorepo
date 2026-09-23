/**
 * Tests of `feature-flags/lib/drivers/static`.
 */
import { describe, expect, test } from 'vitest';
import { FeatureFlagsDriverStatic } from './static.js';

describe('FeatureFlagsDriverStatic', () => {
	test('Evaluates a known flag and turns an unknown one off', async () => {
		const driver = new FeatureFlagsDriverStatic({
			flags: [
				{ key: 'new-billing', enabled: true, rules: { users: ['u1'] } },
				{ key: 'beta-ai', enabled: true },
			],
		});

		// 1. The rules of the definition apply
		await expect(driver.get('new-billing', { user: 'u1' })).resolves.toBe(true);
		await expect(driver.get('new-billing', { user: 'u2' })).resolves.toBe(false);
		await expect(driver.get('beta-ai', {})).resolves.toBe(true);

		// 2. A flag nobody defined is off rather than an error
		await expect(driver.get('missing', { user: 'u1' })).resolves.toBe(false);
	});

	test('Evaluates every flag at once, in the given order', async () => {
		const driver = new FeatureFlagsDriverStatic({
			flags: [
				{ key: 'new-billing', enabled: true, rules: { users: ['u1'] } },
				{ key: 'beta-ai', enabled: false },
			],
		});

		// 1. Key → on or off for the caller
		await expect(driver.getAll({ user: 'u1' })).resolves.toStrictEqual({ 'new-billing': true, 'beta-ai': false });
		await expect(driver.getAll({})).resolves.toStrictEqual({ 'new-billing': false, 'beta-ai': false });
	});

	test('Lists copies of the definitions', async () => {
		const driver = new FeatureFlagsDriverStatic({
			flags: [{ key: 'new-billing', enabled: true, rules: { users: ['u1'] } }],
		});

		// 1. Mutating a listed definition leaves the driver's flags as configured
		const [listed] = await driver.list();

		listed!.rules!.users!.push('u2');
		listed!.enabled = false;

		await expect(driver.list()).resolves.toStrictEqual([
			{ key: 'new-billing', enabled: true, rules: { users: ['u1'] } },
		]);

		await expect(driver.get('new-billing', { user: 'u2' })).resolves.toBe(false);
	});

	test('Refuses an invalid definition and a duplicate key', () => {
		// 1. A bad key or an out-of-range percentage fails at construction, i.e. on the location's first use
		expect(() => new FeatureFlagsDriverStatic({ flags: [{ key: 'New Billing', enabled: true }] })).toThrow();

		expect(
			() => new FeatureFlagsDriverStatic({ flags: [{ key: 'a', enabled: true, rules: { percentage: 150 } }] }),
		).toThrow();

		// 2. Two definitions of one key would make the winner depend on their order
		expect(
			() =>
				new FeatureFlagsDriverStatic({
					flags: [
						{ key: 'a', enabled: true },
						{ key: 'a', enabled: false },
					],
				}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Feature flag "a" is defined twice.]`);
	});
});
