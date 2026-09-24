/**
 * Tests of `read-service-account`: how the service account comes out of the options, whichever way it was given.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { readServiceAccount } from './read-service-account.js';

/**
 * A service account the way the Firebase console downloads it: snake_case fields, the key's newlines escaped as an
 * `.env` line carries them.
 */
const account = { project_id: 'proj', client_email: 'sa@proj.iam.gserviceaccount.com', private_key: 'LINE1\\nLINE2' };

describe('readServiceAccount', () => {
	test('Reads the JSON, then the fields, restoring the newlines of the key', () => {
		// The JSON as the console downloads it: snake_case fields, the key's newlines escaped
		expect(readServiceAccount({ serviceAccount: JSON.stringify(account) })).toStrictEqual({
			projectId: 'proj',
			clientEmail: 'sa@proj.iam.gserviceaccount.com',
			privateKey: 'LINE1\nLINE2',
		});

		// A parsed object wins field by field; the separate options fill what it lacks
		expect(readServiceAccount({ serviceAccount: { projectId: 'p' }, clientEmail: 'c', privateKey: 'k' })).toStrictEqual(
			{
				projectId: 'p',
				clientEmail: 'c',
				privateKey: 'k',
			},
		);

		expect(() => readServiceAccount({ serviceAccount: '{oops' })).toThrow(/not JSON/);
		expect(() => readServiceAccount({ serviceAccount: '{oops' })).toThrow(InvalidConfigError);
	});
});
