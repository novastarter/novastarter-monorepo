import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The Drizzle schema of the app: every table `drizzle-kit generate` writes migrations for and `db.query` knows.
 *
 * Column names are given explicitly, so the mapping is the same whichever driver serves the location and needs no
 * `casing` option.
 */

/**
 * People with an account.
 */
export const users = pgTable('users', {
	/** Identity column: the database hands out the ids, so a client cannot choose one. */
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	/** Sign-in address, unique across accounts. */
	email: text('email').notNull().unique(),
	/** Display name; empty until the person sets one. */
	name: text('name'),
	/** When the row was created; set by the database. */
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	/** When the row was last changed; Drizzle sets it on every update it issues, the database on insert. */
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});
