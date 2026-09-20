import { describe, expect, test } from 'vitest';
import { INTERNAL_JOBS_PATH, internalJobUrl } from './internal-jobs.js';

describe('internalJobUrl', () => {
	test('joins the base URL and the encoded job name on the internal path', () => {
		expect(internalJobUrl('http://localhost:3000', 'mail.send')).toBe(
			'http://localhost:3000/api/internal/jobs/mail.send',
		);

		expect(internalJobUrl('https://app.example.com/', 'system.ping')).toBe(
			`https://app.example.com${INTERNAL_JOBS_PATH}system.ping`,
		);

		expect(internalJobUrl('http://web', 'odd/name')).toBe('http://web/api/internal/jobs/odd%2Fname');
	});
});
