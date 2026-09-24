/**
 * Tests of `logger/utils/redact-query`.
 */
import { REDACTED_TEXT } from '@novastarter/constants';
import { expect, test } from 'vitest';
import { redactQuery } from './redact-query.js';

test('Redacts `access_token` query param', () => {
	const url = '/items/test?access_token=d1r3ctu5';

	const redactedUrl = redactQuery(url);

	expect(redactedUrl).toBe('/items/test?access_token=' + REDACTED_TEXT);
});

test('Returns original string if invalid URL is passed', () => {
	// Redaction must never mangle a line it cannot read.
	const url = '//';
	const redactedUrl = redactQuery(url);
	expect(redactedUrl).toBe(url);
});
