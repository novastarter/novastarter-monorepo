# `@novastarter/database-driver-pglite`

PGlite driver for `@novastarter/database`: in-process Postgres on WebAssembly and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-pglite drizzle-orm
```

No native addon: PGlite is a 10 MB WebAssembly module and a 6 MB data bundle, loaded when the first instance boots. In a
Next.js app it goes into `serverExternalPackages` — it finds those files next to its own module and reads them with
`fs`, which a bundler breaks.

## Usage

Register the class once at start-up, then a location per database with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverPglite } from '@novastarter/database-driver-pglite';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('pglite', DatabaseDriverPglite);

database.registerLocation('default', {
	driver: 'pglite',
	options: {
		connection: env.DATABASE_PGLITE_DIR,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `PgliteDatabase` — a `PgDatabase` like the one the postgres,
supabase and neon drivers hand out, so a `pgTable` schema and its migrations run unchanged — and `ping()`, `migrate()`,
`close()` are the rest of the `DatabaseDriver` contract. `db.$client` is the PGlite instance, for `dumpDataDir()`,
`listen()` and the extensions.

## What it is

A real PostgreSQL running inside the process, without a server: the database for development and tests, and for a
deployment small enough to live in one process. One exclusive connection rather than a pool — PGlite serialises
concurrent queries, and `db.transaction()` works. Building the driver starts the boot (the WebAssembly module, the data
bundle, then `initdb` on a fresh directory); the first query waits for it, and a boot that fails is reported to the
logger and by every query.

`connection` is where the data lives: `memory://` (`MEMORY_DATA_DIR`) for a database that is gone when the driver closes
— tests, throwaway work — or a directory, created with its parents when missing, that survives the process. One instance
per directory at a time: two processes, or two locations, on one directory are not supported. Extensions (`pgvector`,
`uuid_ossp`, …) go in as `options.extensions`; their namespaces are not typed on `db.$client`, so an app that calls them
hands in a `PGlite.create()`d instance of its own instead.

## Options

| Option         | Required | Description                                                                           |
| -------------- | -------- | ------------------------------------------------------------------------------------- |
| `connection`   | yes      | `memory://`, a directory path (`file://` prefix accepted), or a ready `PGlite`.       |
| `options`      | —        | What `new PGlite()` gets: `extensions`, `debug`, `initialMemory`, `username`, …       |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                            |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.           |
| `logger`       | —        | A failed boot and, with `queryLogging`, the queries; the process logger unless given. |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                       |
| `label`        | —        | The location's name, for log lines and errors; `registerLocation()` fills it in.      |
