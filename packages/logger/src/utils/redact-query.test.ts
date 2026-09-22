/**
 * Tests of `logger/utils/redact-query`.
 */
import { REDACTED_TEXT } from '@novastarter/constants';
import { expect, test } from 'vitest';
import { redactQuery } from './redact-query.js';

test('Redacts `access_token` query param', () => {
	// 1. A URL carrying the one param the redaction exists for
	const url = '/items/test?access_token=d1r3ctu5';

	// 2. The value is replaced and the rest of the URL untouched
	const redactedUrl = redactQuery(url);

	expect(redactedUrl).toBe('/items/test?access_token=' + REDACTED_TEXT);
});

test('Returns original string if invalid URL is passed', () => {
	// 1. A string `URL` cannot parse is handed back exactly as it came: redaction must never mangle a line it
	//    cannot read
	const url = '//';
	const redactedUrl = redactQuery(url);
	expect(redactedUrl).toBe(url);
});
