import type { MigrateOptions } from '../types.js';

/**
 * What the Drizzle migrators take: the folder and, when given, where the journal table lives.
 *
 * No `| undefined` on purpose: Drizzle's `MigrationConfig` declares the optional fields without it.
 */
export type MigrationConfig = {
	/** Folder drizzle-kit generated. */
	migrationsFolder: string;
	/** Table Drizzle records the applied migrations in. */
	migrationsTable?: string;
	/** Schema that table lives in; PostgreSQL only. */
	migrationsSchema?: string;
};

/**
 * Turn the options of {@link DatabaseDriver.migrate} into what the dialect's Drizzle migrator takes.
 *
 * Drizzle declares the optional fields without `| undefined`, so the options cannot be spread straight into the
 * migrator under `exactOptionalPropertyTypes`; only the keys that carry a value are copied. A missing folder is
 * refused here rather than by Drizzle, which would report a file it could not read.
 *
 * @param options - The caller's options.
 * @returns The migrator's config, without undefined keys.
 * @throws Error when `migrationsFolder` is missing.
 * @example
 * ```ts
 * await migrate(this.db, toMigrationConfig(options));
 * ```
 */
export const toMigrationConfig = (options: MigrateOptions): MigrationConfig => {
	// 1. Refuse a missing folder up front: Drizzle would fail on reading `undefined/meta/_journal.json`
	if (!options.migrationsFolder) {
		throw new Error('DatabaseDriver.migrate needs a "migrationsFolder"');
	}

	const config: MigrationConfig = { migrationsFolder: options.migrationsFolder };

	// 2. The journal location is copied only when given, so Drizzle falls back to its own defaults otherwise
	if (options.migrationsTable !== undefined) {
		config.migrationsTable = options.migrationsTable;
	}

	if (options.migrationsSchema !== undefined) {
		config.migrationsSchema = options.migrationsSchema;
	}

	return config;
};
