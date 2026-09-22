# `@novastarter/database-driver-postgres`

PostgreSQL driver for `@novastarter/database` on node-postgres and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-postgres drizzle-orm
```

## Usage

Register the class once at start-up, then a location per database with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('postgres', DatabaseDriverPostgres);

database.registerLocation('default', {
	driver: 'postgres',
	options: {
		connection: env.DATABASE_URL,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `NodePgDatabase` over the pool — `db.$client` is the pool
itself — and `ping()`, `migrate()`, `close()` are the rest of the `DatabaseDriver` contract.

The pool opens its connections on the first query. A pool the driver opened from a string or options is ended by
`close()`; its `error` events — an idle client losing its connection — go to the logger instead of crashing the process.
A `Pool` handed in stays the caller's: not ended, and its `error` listener the caller's to add.

## Options

| Option         | Required | Description                                                                           |
| -------------- | -------- | ------------------------------------------------------------------------------------- |
| `connection`   | yes      | Connection string, node-postgres `PoolConfig`, or a ready `Pool` of the caller's own. |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                            |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.           |
| `logger`       | —        | Pool errors and, with `queryLogging`, the queries; the process logger unless given.   |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                       |
| `label`        | —        | The location's name, for log lines and errors; `registerLocation()` fills it in.      |
