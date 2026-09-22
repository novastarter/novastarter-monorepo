/**
 * Tests of `validation/errors/failed-validation`.
 */
import type { ClientFilterOperator, FilterOperator } from '@novastarter/types';
import { describe, expect, test } from 'vitest';
import { messageConstructor } from './failed-validation.js';

/** Can't be randomized, as we're using snapshot tests */
const field = 'test_field';
const path: string[] = [];

describe('No value', () => {
	const types: (FilterOperator | 'required' | 'regex')[] = ['null', 'nnull', 'empty', 'nempty', 'required', 'regex'];

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Valid value (primitive)', () => {
	const types: FilterOperator[] = ['eq', 'lt', 'lte', 'gt', 'gte'];

	/** Can't be randomized, as we're using snapshot tests */
	const valid = 15;

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, valid, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Valid value (list)', () => {
	const types: FilterOperator[] = ['in'];

	/** Can't be randomized, as we're using snapshot tests */
	const valid = ['valA', 'valB', 'valC'];

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, valid, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Invalid value (primitive)', () => {
	const types: FilterOperator[] = ['neq'];

	/** Can't be randomized, as we're using snapshot tests */
	const invalid = 15;

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, invalid, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Invalid value (list)', () => {
	const types: FilterOperator[] = ['nin'];

	/** Can't be randomized, as we're using snapshot tests */
	const invalid = ['valA', 'valB', 'valC'];

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, invalid, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Substring', () => {
	// The affix operators are client-only, so the list needs the client operator type, not the storage one
	const types: ClientFilterOperator[] = [
		'contains',
		'icontains',
		'ncontains',
		'starts_with',
		'nstarts_with',
		'istarts_with',
		'nistarts_with',
		'ends_with',
		'nends_with',
		'iends_with',
		'niends_with',
	];

	/** Can't be randomized, as we're using snapshot tests */
	const substring = 'test_substring';

	test.each(types)('Constructs message for "%s"', (type) => {
		// 1. Snapshot the message so a wording change is a deliberate diff, not a silent one
		const message = messageConstructor({ field, type, substring, path });

		expect(message).toMatchSnapshot();
	});
});

describe('Unsafe', () => {
	test('Constructs message for "unsafe"', () => {
		// 1. The catch-all rule names no specific expectation, since refinements, unions and unknown keys all map to it
		const message = messageConstructor({
			field,
			type: 'unsafe',
			path,
		});

		expect(message).toMatchSnapshot();
	});
});

describe('Nested path', () => {
	test('Names the path below the field', () => {
		// 1. The path is joined with dots, indices included, so the client can point at the exact input
		const message = messageConstructor({ field, type: 'required', path: ['address', 0, 'city'] });

		expect(message).toBe('Validation failed for field "test_field" at "address.0.city". Value is required.');
	});
});
