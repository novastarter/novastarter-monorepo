# `@novastarter/database-driver-turso`

Turso and libSQL driver for `@novastarter/database` on @libsql/client and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-turso drizzle-orm
```

`@libsql/client` brings the libSQL native binding as prebuilt platform packages; no build step runs at install. Next.js
already keeps it out of the bundle.

## Usage

Register the class once at start-up, then a location per database with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverTurso } from '@novastarter/database-driver-turso';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('turso', DatabaseDriverTurso);

database.registerLocation('default', {
	driver: 'turso',
	options: {
		connection: {
			url: env.TURSO_DATABASE_URL,
			authToken: env.TURSO_AUTH_TOKEN,
		},
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `LibSQLDatabase` — asynchronous throughout, unlike the
better-sqlite3 driver's: `await db.select()…`, `db.batch([...])` for several statements in one transaction,
`db.transaction()` for an interactive one — and `ping()`, `migrate()`, `close()` are the rest of the `DatabaseDriver`
contract. The schema is written with `sqliteTable`. `db.$client` is the libsql client, for `sync()` and
`executeMultiple()`.

## Three ways to run

- **A local file** — `file:./data/app.db`; the directory is created when missing, and the file is opened when the driver
  is built. `:memory:` (`MEMORY_URL`) for a database that lives as long as the driver. `encryptionKey` encrypts the file
  (plain SQLite tools can no longer open it); `timeout` is the busy wait in milliseconds.
- **A remote Turso database** — `libsql://db-org.turso.io` with `authToken`; HTTPS on Node, `wss://` for a WebSocket.
- **An embedded replica** — a local `file:` plus `syncUrl` and `authToken`: reads come from the file, writes go to the
  remote, `syncInterval` (seconds) pulls in the background and `db.$client.sync()` on demand.

`connection` takes the whole `Config` of `@libsql/client`, so every field it grows is available; `intMode: 'bigint'` for
64-bit integers. The fields are typed without `undefined`: build the object from the values the app has rather than
spreading possibly-unset variables into it.

## Options

| Option         | Required | Description                                                                       |
| -------------- | -------- | --------------------------------------------------------------------------------- |
| `connection`   | yes      | A URL, the `Config` of `@libsql/client`, or a ready `Client` of the caller's own. |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                        |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.       |
| `logger`       | —        | Where the queries go with `queryLogging`; the process logger unless given.        |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                   |
