# `@novastarter/emitter`

Filter, action and init hooks for Novastarter.

## Description

One process-wide event bus with three channels, ported from the Directus API emitter:

- **filter** — runs before an operation, handlers run one after another and may replace the payload;
- **action** — runs after an operation, fire-and-forget, a failing handler is logged and never breaks the operation;
- **init** — marks stages of application start-up, so a hook registers routes or jobs at the right moment.

Event names are dotted and wildcards are supported (`items.*.create`). This is how a startup extends the core modules
without editing them: the core emits, the startup subscribes.

## Installation

```
pnpm add @novastarter/emitter
```

## Usage

```ts
import { useEmitter } from '@novastarter/emitter';

const emitter = useEmitter();

emitter.onFilter('user.create', (payload) => ({ ...payload, source: 'api' }));
emitter.onAction('user.create', ({ key }) => audit(key));
emitter.onInit('routes.after', ({ app }) => app.use(customRouter));

const payload = await emitter.emitFilter('user.create', input, { collection: 'users' }, context);
emitter.emitAction('user.create', { key: created.id, payload }, context);
await emitter.emitInit('routes.after', { app });
```

The context handed to handlers is an `EventContext` from `@novastarter/types`: `accountability` plus whatever the
emitting code attaches (a database handle, a schema). Without a context, handlers receive `{ accountability: null }`.
