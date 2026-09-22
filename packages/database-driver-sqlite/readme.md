# `@novastarter/database-driver-sqlite`

SQLite driver for `@novastarter/database` on better-sqlite3 and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-sqlite drizzle-orm
```

`better-sqlite3` is a native addon shipping prebuilt binaries for every common platform; no build step runs at install.
In a Next.js app it goes into `serverExternalPackages`.

## Usage

Register the class once at start-up, then a location per file with the options read from the application's configuration
— `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverSqlite } from '@novastarter/database-driver-sqlite';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('sqlite', DatabaseDriverSqlite);

database.registerLocation('default', {
	driver: 'sqlite',
	options: {
		file: env.DATABASE_FILE,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `BetterSQLite3Database` — `db.$client` is the better-sqlite3
handle, for pragmas and backups — and `ping()`, `migrate()`, `close()` are the rest of the `DatabaseDriver` contract.

better-sqlite3 is synchronous: the queries answer without awaiting (`db.select().from(t).all()`, `await` works too), and
`ping()` and `migrate()` have done their work before their promise resolves. The file and its directory are created when
the driver is built; `:memory:` (`MEMORY_FILE`) opens a database that lives as long as the driver, for tests and
throwaway work.

## Options

| Option         | Required | Description                                                                        |
| -------------- | -------- | ---------------------------------------------------------------------------------- |
| `file`         | yes      | Path of the database file, created with its directory when missing, or `:memory:`. |
| `options`      | —        | better-sqlite3 open options: `readonly`, `fileMustExist`, `timeout`, `verbose`.    |
| `foreignKeys`  | —        | `PRAGMA foreign_keys = ON`; on by default, since SQLite leaves it off.             |
| `wal`          | —        | `PRAGMA journal_mode = WAL`; on by default for a file, off for `:memory:`.         |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                         |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.        |
| `logger`       | —        | Where the queries go with `queryLogging`; the process logger unless given.         |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                    |
