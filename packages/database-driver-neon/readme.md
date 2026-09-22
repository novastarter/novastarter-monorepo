# `@novastarter/database-driver-neon`

Neon Postgres drivers for `@novastarter/database` on @neondatabase/serverless and Drizzle ORM.

## Installation

```
pnpm add @novastarter/database @novastarter/database-driver-neon drizzle-orm
```

## Usage

Two classes, one per transport Neon offers; register the one the deployment needs — or both — then a location per
database with the options read from the application's configuration — `env` is the app's typed configuration — the zod
schema of the `@novastarter/env` readme. `connection` is the connection string of the Neon console, `?sslmode=require`
included: TLS is the WebSocket or HTTPS tunnel itself.

```ts
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverNeon, DatabaseDriverNeonHttp } from '@novastarter/database-driver-neon';
import { env } from './env';
import * as schema from './db/schema';

const database = useDatabase();

database.registerDriver('neon', DatabaseDriverNeon);
database.registerDriver('neon-http', DatabaseDriverNeonHttp);

database.registerLocation('default', {
	driver: 'neon',
	options: {
		connection: env.DATABASE_URL,
		schema,
	},
});
```

Anywhere later: `useDatabase().location().db` is Drizzle's `NeonDatabase` (`neon`) or `NeonHttpDatabase` (`neon-http`),
both Postgres databases sharing `PgDatabase`; `ping()`, `migrate()` and, for the pool, `close()` are the rest of the
`DatabaseDriver` contract.

## Which transport

`neon` — a node-postgres pool carried over WebSocket. Sessions, so `db.transaction()` works and `migrate()` runs in one
transaction; `close()` ends the pool. Runs wherever there is a `WebSocket`: Node 22 and later has one, older runtimes
set `neonConfig.webSocketConstructor` first. A fresh connection pays for the WebSocket handshake, so a process that
keeps its pool between requests is what it is for.

`neon-http` — one fetch per query. Nothing to warm up, nothing to close, the lowest latency for a single statement: what
a serverless function or an edge runtime wants. No sessions: `db.transaction()` throws
(`No transactions support in neon-http driver`), `db.batch([...])` runs several statements in one non-interactive
transaction instead, and `migrate()` applies its statements one by one without a rollback — a failing migration leaves
the statements before it applied; fix the cause and run again. `options.authToken` carries a JWT for Neon Authorize.

Over plain TCP — a long-running server with sockets — `@novastarter/database-driver-postgres` on the same connection
string is the simpler choice.

## Local development

`neonConfig` of `@neondatabase/serverless` — `fetchEndpoint`, `wsProxy`, `useSecureWebSocket`, `webSocketConstructor` —
is process-wide, which is why it is not a location option: two locations could not disagree on it. An app running
against Neon Local or a self-hosted proxy sets it once, before the first `location()`:

```ts
import { neonConfig } from '@neondatabase/serverless';

neonConfig.fetchEndpoint = 'http://localhost:4444/sql';
neonConfig.wsProxy = 'localhost:4444/v2';
neonConfig.useSecureWebSocket = false;
```

## Options of `neon`

| Option         | Required | Description                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| `connection`   | yes      | Connection string, `PoolConfig` of `@neondatabase/serverless`, or a ready `Pool`.   |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                          |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.         |
| `logger`       | —        | Pool errors and, with `queryLogging`, the queries; the process logger unless given. |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                     |

## Options of `neon-http`

| Option         | Required | Description                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| `connection`   | yes      | Connection string, or a ready `neon()` query function of the caller's own.          |
| `options`      | —        | What `neon()` is called with: `authToken`, `fetchOptions`, isolation for `batch()`. |
| `schema`       | —        | The Drizzle schema, for `db.query` and the typing of `db`.                          |
| `casing`       | —        | `snake_case` or `camelCase`: column names for properties that declare none.         |
| `logger`       | —        | Where the queries go with `queryLogging`; the process logger unless given.          |
| `queryLogging` | —        | Log every query with its parameters at `debug`.                                     |
