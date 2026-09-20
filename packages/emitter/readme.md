# `@novastarter/emitter`

Filter, action and init hooks for Novastarter.

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
emitter.emitAction(
	'user.create',
	{
		key: created.id,
		payload,
	},
	context,
);
await emitter.emitInit('routes.after', { app });
```

The context handed to handlers is an `EventContext` from `@novastarter/types`: `accountability` plus whatever the
emitting code attaches (a database handle, a schema). Without a context, handlers receive `{ accountability: null }`.
