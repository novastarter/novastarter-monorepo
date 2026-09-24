/**
 * Tests of `database/lib/to-migration-config`.
 */
import { describe, expect, test } from 'vitest';
import { toMigrationConfig } from './to-migration-config.js';

describe('toMigrationConfig', () => {
	test('Throws when the folder is missing', () => {
		// An empty string is as missing as an absent key: Drizzle would try to read a journal at `/meta/_journal.json`
		expect(() => toMigrationConfig({ migrationsFolder: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. DatabaseDriver.migrate needs a "migrationsFolder".]`,
		);
	});

	test('Answers the folder alone when nothing else is given', () => {
		// `toStrictEqual` sees an undefined key as a key: the journal fields may not be present
		expect(
			toMigrationConfig({ migrationsFolder: './drizzle', migrationsTable: undefined, migrationsSchema: undefined }),
		).toStrictEqual({ migrationsFolder: './drizzle' });
	});

	test('Copies the journal table and schema when given', () => {
		expect(
			toMigrationConfig({ migrationsFolder: './drizzle', migrationsTable: 'migrations', migrationsSchema: 'app' }),
		).toStrictEqual({ migrationsFolder: './drizzle', migrationsTable: 'migrations', migrationsSchema: 'app' });
	});
});
