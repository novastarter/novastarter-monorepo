# `@novastarter/database-driver-d1`

Cloudflare D1 driver for `@novastarter/database` on Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-d1 drizzle-orm
```

## Usage

D1 has no connection string: the platform injects a `D1Database` binding into the code it runs, and the location is
registered with that binding — in a Worker from `env`, once per isolate:

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverD1 } from '@novastarter/database-driver-d1';
import * as schema from './db/schema';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const database = useDatabase();

		if (!database.hasLocation('default')) {
			database.registerDriver('d1', DatabaseDriverD1);
			database.registerLocation('default', {
				driver: 'd1',
				options: {
					binding: env.DB,
					schema,
				},
			});
		}

		const notes = await database.location().db.select().from(schema.notes);

		return Response.json(notes);
	},
};
```

Under OpenNext for Cloudflare the binding is `getCloudflareContext().env.DB`; in a local Node script or test it is the
`env` of wrangler's `getPlatformProxy()`. The schema is written with `sqliteTable` — D1 is SQLite — and the API is
asynchronous, unlike the better-sqlite3 driver's. `db.$client` is the binding.

`binding` is typed by `@cloudflare/workers-types`, which the package depends on; the globals `wrangler types` generates
are the same declarations and make Drizzle's `D1Result` fully typed in the app.

## Transactions and migrations

`db.transaction()` sends `begin` and `commit`, which D1 rejects — `capabilities.transactions` is `false`;
`db.batch([...])` runs several statements atomically instead. There is nothing to close: the binding is the platform's.

`migrate()` reads the folder through `node:fs`, so it runs from a Node process holding the binding — a deploy script
over `getPlatformProxy()` — not from inside a Worker. The alternative is wrangler's own journal:
`wrangler d1 migrations apply <DB> --remote` on drizzle-kit's `out` folder (`migrations_dir` in `wrangler.jsonc`). Pick
one: wrangler's `d1_migrations` table and Drizzle's `__drizzle_migrations` do not know about each other.
`migrationsSchema` means nothing to SQLite.

The kit logger (pino) and the migrator need the `nodejs_compat` compatibility flag in the Worker.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `binding`      | yes      | The `D1Database` binding: `env.DB` in a Worker, `getPlatformProxy().env.DB` locally. |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                           |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.          |
| `logger`       | —        | Where the queries go with `queryLogging`; the process logger unless given.           |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                      |
| `label`        | —        | The location's name, for log lines and errors; `registerLocation()` fills it in.     |
