# `@novastarter/database-driver-supabase`

Supabase Postgres driver for `@novastarter/database` on node-postgres and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-supabase drizzle-orm
```

## Usage

Register the class once at start-up, then a location per project with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverSupabase } from '@novastarter/database-driver-supabase';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('supabase', DatabaseDriverSupabase);

database.registerLocation('default', {
	driver: 'supabase',
	options: {
		url: env.DATABASE_URL,
		ca: env.DATABASE_SSL_CA,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `NodePgDatabase`, as with
`@novastarter/database-driver-postgres`, which this driver runs on; `ping()`, `migrate()`, `close()` are the rest of the
`DatabaseDriver` contract.

## Connecting

The `url` is the connection string the project's dashboard shows under Connect, in one of its three forms:

- the transaction pooler, port `6543` — for serverless and short-lived processes; statements cannot be prepared across
  queries there, so use Drizzle's query builder, `execute()` and `migrate()` (all fine) and not `.prepare(name)`;
- the session pooler, port `5432` on the pooler host — one server connection per client, everything works;
- the direct host, `db.<ref>.supabase.co:5432` — IPv6 unless the project has the IPv4 add-on.

Leave `sslmode` out of the URL: node-postgres lets the URL override the `ssl` option, and recent versions warn on
`sslmode=require`. TLS is on by default and verifies the server against the system's root certificates; when the
server's certificate does not chain to a public root, download the project's root certificate (`prod-ca-2021.crt`, under
the database settings) and pass its PEM as `ca` — a `DATABASE_SSL_CA_FILE` secret through `@novastarter/env`. The local
Supabase CLI stack speaks plain TCP: `ssl: false`.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `url`          | yes      | The dashboard's connection string, without `sslmode`.                                |
| `ssl`          | —        | `true` (default) verifies against the system roots; an object as given; `false` off. |
| `ca`           | —        | PEM of the project's root certificate, laid over `ssl` as its `ca`.                  |
| `pool`         | —        | Further node-postgres pool options (`max`, `idleTimeoutMillis`, …).                  |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                           |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.          |
| `logger`       | —        | Pool errors and, with `queryLogging`, the queries; the process logger unless given.  |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                      |
