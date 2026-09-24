/**
 * Tests of `release-notes-generator/utils/sort`.
 */
import { describe, expect, test } from 'vitest';
import { sortByExternalOrder, sortByObjectValues } from './sort.js';

/**
 * Shape of the items sorted in these tests, mirroring the packages and sections of the release notes.
 */
interface Item {
	name: string;
}

describe('sortByExternalOrder', () => {
	const compare = sortByExternalOrder<Item, string[], 'name'>(['first', 'second'], 'name');

	test('should order two listed items by their position in the list', () => {
		expect(compare({ name: 'first' }, { name: 'second' })).toBeLessThan(0);
		expect(compare({ name: 'second' }, { name: 'first' })).toBeGreaterThan(0);
		expect(compare({ name: 'first' }, { name: 'first' })).toBe(0);
	});

	test('should put a listed item before an unlisted one', () => {
		expect(compare({ name: 'second' }, { name: 'other' })).toBeLessThan(0);
	});

	test('should put an unlisted item after a listed one', () => {
		// The mirror case, so the comparator is symmetric: unlisted items sort after the listed ones from
		// either direction
		expect(compare({ name: 'other' }, { name: 'first' })).toBeGreaterThan(0);
	});

	test('should keep the existing order of unlisted items', () => {
		expect(compare({ name: 'other' }, { name: 'another' })).toBe(0);
	});

	test('should sort listed items first and leave the rest in place', () => {
		const items: Item[] = [{ name: 'b' }, { name: 'second' }, { name: 'a' }, { name: 'first' }];

		expect(items.sort(compare).map((item) => item.name)).toEqual(['first', 'second', 'b', 'a']);
	});

	test('should leave everything untouched with an empty list', () => {
		// The config ships an empty package order, so this is the common case in this repo
		const items: Item[] = [{ name: 'b' }, { name: 'a' }];

		expect(items.sort(sortByExternalOrder<Item, string[], 'name'>([], 'name')).map((item) => item.name)).toEqual([
			'b',
			'a',
		]);
	});
});

describe('sortByObjectValues', () => {
	const compare = sortByObjectValues<Item, Record<string, string>, 'name'>({ major: 'Major', patch: 'Patch' }, 'name');

	test('should order two listed items by the insertion order of the object values', () => {
		expect(compare({ name: 'Major' }, { name: 'Patch' })).toBeLessThan(0);
		expect(compare({ name: 'Patch' }, { name: 'Major' })).toBeGreaterThan(0);
		expect(compare({ name: 'Major' }, { name: 'Major' })).toBe(0);
	});

	test('should put an unlisted item before a listed one', () => {
		// A missing value has index -1, which sorts ahead of every listed position
		expect(compare({ name: 'Other' }, { name: 'Major' })).toBeLessThan(0);
		expect(compare({ name: 'Major' }, { name: 'Other' })).toBeGreaterThan(0);
	});

	test('should treat two unlisted items as equal', () => {
		expect(compare({ name: 'Other' }, { name: 'Another' })).toBe(0);
	});

	test('should sort sections the way the config lists their titles', () => {
		const items: Item[] = [{ name: 'Patch' }, { name: 'Major' }];

		expect(items.sort(compare).map((item) => item.name)).toEqual(['Major', 'Patch']);
	});
});
