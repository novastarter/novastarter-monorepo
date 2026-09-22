/**
 * Tests of `internal-jobs`: the URL contract of the upcoming internal-jobs endpoint, built on the internal path
 * constant.
 */
import { describe, expect, test } from 'vitest';
import { INTERNAL_JOBS_PATH, internalJobUrl } from './internal-jobs';

describe('internalJobUrl', () => {
	test('joins the base URL and the encoded job name on the internal path', () => {
		// 1. A plain base URL and a dotted job name: the name lands on the path as-is
		expect(internalJobUrl('http://localhost:3000', 'mail.send')).toBe(
			'http://localhost:3000/api/internal/jobs/mail.send',
		);

		// 2. A trailing slash on the base does not double the separator — the path constant carries it
		expect(internalJobUrl('https://app.example.com/', 'system.ping')).toBe(
			`https://app.example.com${INTERNAL_JOBS_PATH}system.ping`,
		);

		// 3. A name that is itself a path is encoded, so it stays one segment
		expect(internalJobUrl('http://web', 'odd/name')).toBe('http://web/api/internal/jobs/odd%2Fname');
	});
});
