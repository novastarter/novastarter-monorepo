# `@novastarter/database`

Relational database abstraction layer for Novastarter on Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-postgres drizzle-orm
```

One driver package per backend: `database-driver-postgres`, `database-driver-sqlite`, `database-driver-supabase`. The
application depends on `drizzle-orm` itself: the schema (`pgTable`, `sqliteTable`), the operators (`eq`, `sql`) and the
queries are Drizzle's; this package only hands out the database.

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

`registerLocation()` checks that the driver exists and keeps the options; the first `location(name)` builds the driver,
so an unused location never opens a pool. `location(name)` throws for a name nobody registered; `hasLocation(name)` and
`locationNames()` inspect the registry, `instantiated()` lists what was built so far, `close()` releases the drivers
built so far at shutdown — the pools, the file handles — and keeps the registrations.

## The contract

Every driver exposes the same four members:

| Member             | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `db`               | The Drizzle database of the dialect: `NodePgDatabase` or `BetterSQLite3Database`.             |
| `ping()`           | One `select 1`, so a bootstrap or a health check can prove the location is reachable.         |
| `migrate(options)` | Drizzle's migrator over a drizzle-kit folder; `migrationsTable`, `migrationsSchema` optional. |
| `close()`          | Ends the pool or closes the file; a pool the application handed in stays the application's.   |

A Drizzle schema is bound to its dialect — `pgTable` against PostgreSQL, `sqliteTable` against SQLite, and the two
databases differ in their API (`NodePgDatabase` is asynchronous, `BetterSQLite3Database` synchronous) — so a location
cannot switch dialects the way a queue switches from Redis to in-process; the drivers of one dialect (`postgres`,
`supabase`) are interchangeable.

Every driver takes, next to its connection options, `schema`, `casing` (`snake_case` or `camelCase`), `logger` (the kit
logger, the process one unless given) and `queryLogging` (every query with its parameters at `debug`).

A driver refuses a missing option at construction with a plain `Error` naming it:
`The postgres database driver needs a "connection"`.

## Writing a driver

A driver is a class taking its options in the constructor and implementing `DatabaseDriver<Db>` from this package, with
`Db` the Drizzle database type of its dialect; see `@novastarter/database-driver-sqlite` for the smallest one.
`toDrizzleOptions(config, logger)` turns the shared options into what `drizzle()` takes — without the `undefined` keys
Drizzle's types refuse — and `toMigrationConfig(options)` does the same for the migrator. The package registers its
options in the driver map, so a location naming it is type-checked:

```ts
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		mysql: DatabaseDriverMysqlConfig;
	}
}
```
