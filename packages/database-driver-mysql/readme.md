# `@novastarter/database-driver-mysql`

MySQL driver for `@novastarter/database` on mysql2 and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-mysql drizzle-orm
```

## Usage

Register the class once at start-up, then a location per database with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverMysql } from '@novastarter/database-driver-mysql';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('mysql', DatabaseDriverMysql);

database.registerLocation('default', {
	driver: 'mysql',
	options: {
		connection: env.DATABASE_URL,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `MySql2Database` over a `mysql2/promise` pool — `db.$client`
is the pool itself — and `ping()`, `migrate()`, `close()` are the rest of the `DatabaseDriver` contract. The schema is
written with `mysqlTable`; MariaDB speaks the same protocol.

The pool opens its connections on the first query. A pool the driver opened from a URI or options is ended by `close()`;
a pool handed in stays the caller's. mysql2 reports no `error` event on its pool — a dropped idle connection is
discarded inside it — so there is nothing to listen to, unlike node-postgres.

`mode` is what Drizzle's relational queries (`db.query`) are built with: `default` joins through lateral subqueries,
`planetscale` avoids them for a database without foreign-key support (PlanetScale, Vitess). Drizzle refuses a schema
without a mode, so the driver always passes one.

`migrationsSchema` means nothing to MySQL; `migrationsTable` is the journal's name. A URI can carry pool options as
query parameters (`?connectionLimit=4`); pool options are typed without `undefined`, so an app builds them from values
it has rather than spreading possibly-unset variables in.

## Options

| Option         | Required | Description                                                                             |
| -------------- | -------- | --------------------------------------------------------------------------------------- |
| `connection`   | yes      | Connection URI, mysql2 `PoolOptions`, or a ready `mysql2/promise` pool of the caller's. |
| `mode`         | —        | `default` or `planetscale`: how Drizzle builds relational queries.                      |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                              |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.             |
| `logger`       | —        | Where the queries go with `queryLogging`; the process logger unless given.              |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                         |
