# 0001. Apps register managers explicitly

## Context

Subsystems (storage, database, mail, queue and the rest) used to configure themselves from the environment: a
`getConfigFromEnv` helper read variables under a prefix, and `<PREFIX>_LOCATIONS` listed the locations to build. The
wiring was invisible: nothing in the app said which drivers and locations existed, a typo in a variable name silently
dropped a location, and each package had to know the app's naming.

## Decision

- No `getConfigFromEnv`, no prefixes, no `<PREFIX>_LOCATIONS`. A package reads nothing and registers nothing by itself.
- The app registers every manager at start-up, in `apps/web/bootstrap.ts`, in this order: `useX()` (the process-wide
  `new XManager()`) → `registerDriver(name, DriverClass)` → `registerLocation(name, { driver, options })`; code later
  calls `useX().location(name)`.
- The options come from `apps/web/config/<subsystem>.ts`: plain functions over the app's variables, which `env.ts` reads
  once through `@novastarter/env` and checks against a zod schema.
- Every subsystem has the same API, from `DriverManager` (or `LocationManager`) in `@novastarter/utils`. Storage is the
  reference.

## Consequences

- One file shows everything the app runs on; a missing or malformed variable fails at start-up with its name.
- A new location or driver is a code change in the app, not a new variable.
- A new subsystem repeats the same manager shape instead of inventing its own.
