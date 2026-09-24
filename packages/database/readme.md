# `@novastarter/database`

Relational database abstraction layer for Novastarter on Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-postgres drizzle-orm
```

One driver package per backend: `database-driver-postgres`, `database-driver-supabase`, `database-driver-neon` (a
WebSocket pool and an HTTP class), `database-driver-pglite` (Postgres in the process), `database-driver-mysql`,
`database-driver-sqlite`, `database-driver-turso`, `database-driver-d1`. The application depends on `drizzle-orm`
itself: the schema (`pgTable`, `mysqlTable`, `sqliteTable`), the operators (`eq`, `sql`) and the queries are Drizzle's;
this package only hands out the database.

## Usage

At start-up, once — drivers as classes, locations as explicit options; a driver is built on the location's first use,
which is when its pool opens. `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme —
and `schema` the app's Drizzle schema module.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
import { DatabaseDriverSqlite } from '@novastarter/database-driver-sqlite';
import { env } from './env';
import * as analyticsSchema from './db/analytics-schema';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('postgres', DatabaseDriverPostgres);
database.registerDriver('sqlite', DatabaseDriverSqlite);

database.registerLocation('default', {
	driver: 'postgres',
	options: {
		connection: env.DATABASE_URL,
		schema,
	},
});

database.registerLocation('analytics', {
	driver: 'sqlite',
	options: {
		file: env.ANALYTICS_FILE,
		schema: analyticsSchema,
	},
});
```

Next to the registration, once, the application says what each location's `db` is, so no call site needs a cast:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './db/schema';

declare module '@novastarter/database' {
	interface DatabaseLocations {
		default: NodePgDatabase<typeof schema>;
	}
}
```

Anywhere later:

```ts
import { eq } from 'drizzle-orm';
import { useDatabase } from '@novastarter/database';
import { users } from './db/schema';

const { db } = useDatabase().location();

const ada = await db.select().from(users).where(eq(users.email, 'ada@example.com'));
const all = await db.query.users.findMany();
```

And at deploy time, or at start-up, the migrations `drizzle-kit generate` wrote for the schema:

```ts
await useDatabase().location().migrate({ migrationsFolder: './drizzle' });
```

The `web` app shows the whole loop: `db/schema.ts`, `drizzle.config.ts`, the committed `drizzle/` folder,
`pnpm --filter web db:generate` / `db:migrate` (`scripts/migrate.ts`) and `DATABASE_MIGRATE=true` for a start-up that
migrates first.

`registerLocation()` checks that the driver exists and keeps the options; the first `location(name)` builds the driver,
so an unused location never opens a pool. `location(name)` throws for a name nobody registered; `hasLocation(name)` and
`locationNames()` inspect the registry, `instantiated()` lists what was built so far, `close()` releases the drivers
built so far at shutdown — the pools, the file handles — and keeps the registrations.

## The contract

Every driver exposes the same five members:

| Member             | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `db`               | The Drizzle database of the dialect: `NodePgDatabase` or `BetterSQLite3Database`.             |
| `capabilities`     | `{ transactions }`: whether `db.transaction()` works — not over `neon-http`, not on `d1`.     |
| `ping()`           | One `select 1`; throws `DatabaseUnavailableError` (`DATABASE_UNAVAILABLE`, 503) otherwise.    |
| `migrate(options)` | Drizzle's migrator over a drizzle-kit folder; `migrationsTable`, `migrationsSchema` optional. |
| `close()`          | Ends the pool or closes the file; a pool the application handed in stays the application's.   |

`capabilities.transactions` is what an application reads before choosing between `db.transaction()` and `db.batch()`,
rather than the driver's name. `ping()` wraps whatever the backend raised — refused connection, timeout, an instance
that never came up — so a health check tells an unreachable database from a failing query:

```ts
import { DatabaseUnavailableError, useDatabase } from '@novastarter/database';

try {
	await useDatabase().location().ping();
} catch (error) {
	if (error instanceof DatabaseUnavailableError) return { status: 503, reason: error.extensions.reason };
	throw error;
}
```

A Drizzle schema is bound to its dialect — `pgTable` against PostgreSQL, `mysqlTable` against MySQL, `sqliteTable`
against SQLite — so a location cannot switch dialects the way a queue switches from Redis to in-process. The Postgres
drivers (`postgres`, `supabase`, `neon`, `neon-http`, `pglite`) are interchangeable and share `PgDatabase` — PGlite runs
the same schema inside the process, which is what an app falls back on without a server; `sqlite`, `turso` and `d1`
share the schema but not the API — `BetterSQLite3Database` is synchronous, `LibSQLDatabase` and `DrizzleD1Database`
asynchronous.

Every driver takes, next to its connection options, `schema`, `casing` (`snake_case` or `camelCase`), `logger` (the kit
logger, the process one unless given), `queryLogging` (every query with its parameters at `debug`) and `label` — the
location's name, which `registerLocation()` fills in, so every log line of the driver carries `database: "<name>"` and
`DatabaseUnavailableError` says which location is down.

A driver refuses a missing option at construction with an `InvalidConfigError` (`INVALID_CONFIG`) naming it:
`Invalid config. The postgres database driver needs a "connection".`

## Writing a driver

A driver is a class taking its options in the constructor and implementing `DatabaseDriver<Db>` from this package, with
`Db` the Drizzle database type of its dialect; see `@novastarter/database-driver-sqlite` for the smallest one.
`resolveLogger(config)` gives the logger to report through, bound to the location's label;
`toDrizzleOptions(config, logger)` turns the shared options into what `drizzle()` takes — without the `undefined` keys
Drizzle's types refuse — and `toMigrationConfig(options)` does the same for the migrator; `ensureDirectory(path)`
creates a data directory with its parents; `toUnavailableError(error, label)` is what `ping()` throws; `hasMethods` of
`@novastarter/utils` tells a client the application handed in from its options. The package registers its options in the
driver map, so a location naming it is type-checked:

```ts
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		cockroach: DatabaseDriverCockroachConfig;
	}
}
```
