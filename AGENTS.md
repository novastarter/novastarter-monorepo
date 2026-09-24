## Super-rule: English only

Overrides everything else.

Everything is in English: code, comments, docs, commit messages, changesets, PR titles and descriptions, issues, file
names, identifiers, error messages, logs, chat replies to the user, questions, plans. No other language, no exceptions.
Input in another language is answered in English.

## Rule: never push to git

Mandatory, no exceptions.

- Never run `git push` in any form: plain, `--force`, `--tags`, `-u origin <branch>`, via `gh pr create --push`, via
  scripts or hooks, or under any other name.
- Not after a commit, not "to finish the task", not because a PR needs the branch. Pushing is done by the user, by hand.
- Committing and pushing are separate steps. A request to commit is never a request to push.

## Commands

Run from the repository root. Apps are named `web` and `docs`, packages `@novastarter/<dir>`.

- `pnpm install` — install everything; also installs the lefthook git hooks.
- `pnpm turbo run test --filter=@novastarter/<name>` — test one package; `check-types` and `build` work the same way.
  Turbo builds the workspace dependencies first (`^build`).
- `pnpm --filter @novastarter/<name> test | check-types | build` runs the script alone, without building dependencies:
  it fails with "Cannot find module '@novastarter/…'" or "Failed to resolve entry" until they are built. Build them
  once with `pnpm turbo run build --filter='@novastarter/<name>^...'`.
- `pnpm --filter @novastarter/<name> exec vitest run src/x.test.ts` — one test file (dependencies built, see above).
- `pnpm build`, `pnpm check-types`, `pnpm test` — the whole repo through turbo.
- `pnpm lint` — ESLint over the whole repo, check only. `pnpm exec eslint <file>` — one file.
- `pnpm format` — Prettier check only. `pnpm exec prettier --write <file>` — format one file.
- `pnpm check:catalog` — every dependency version comes from the catalog (see "dependency versions only via catalog:").

The Stop hook `.claude/hooks/typecheck.mjs` runs `check-types` through turbo for every package or app with uncommitted
changes and keeps the turn open while it fails.

Never run a fixer over the whole repo (`pnpm lint --fix`, `prettier --write .`): other work may be in the same tree.

## Repo map

- `apps/web` — the Next.js app: env schema, location configs, `bootstrap.ts` that wires every subsystem, jobs, the
  database schema and migrations. See `apps/web/AGENTS.md`.
- `apps/docs` — the Next.js documentation site. See `apps/docs/AGENTS.md`.
- Base: `types`, `constants`, `errors`, `utils` (`DriverManager`, `LocationManager`, `singleton`), `tsconfig`.
- Process: `env` (the only reader of `process.env`), `logger`, `emitter` (hooks), `pressure`, `validation`, `http`
  (outgoing requests for drivers).
- Subsystems, each a manager plus `<name>-driver-*` packages: `storage`, `database`, `mail`, `sms`, `push`, `payments`,
  `auth`, `messenger`, `queue`.
- Other subsystems: `redis` (named ioredis clients), `memory` (key-value, cache, bus, limiter), `ai`, `feature-flags`,
  `notifications` (one message over mail, SMS, push, messengers, inbox).
- Tooling: `release-notes-generator` (builds release notes from changesets).

The driver / manager / factory pattern. A subsystem package exports a manager class that extends `DriverManager` from
`@novastarter/utils` (or `LocationManager` when there is no driver to pick, as in `redis`), a driver contract, and
`useX()`, a process-wide singleton of the manager. A driver package exports one driver class and adds its options to
the subsystem's `XDrivers` interface with `declare module`. The app wires it at start-up:

```ts
useStorage().registerDriver('s3', StorageDriverS3);
useStorage().registerLocation('uploads', { driver: 's3', options: { bucket: 'uploads' } });

await useStorage().location('uploads').write('avatar.png', stream, 'image/png');
```

A location is built on its first `location()` call, so unused locations open nothing. Why: `docs/decisions/0001`.

## Reference package

Copy `packages/storage` (a subsystem) and `packages/storage-driver-s3` (a driver): layout, `package.json`, `exports`,
scripts, `src/index.ts`, tests, JSDoc. Do not copy a random neighbour; older packages may lag behind.

## Decisions

Why things are the way they are: `docs/decisions/` (ADRs, one short note per decision). Read the list before proposing
a change to structure, configuration or exports.

## Rule: keep the map, commands and decisions up to date

Mandatory, no exceptions.

- A change to the repo structure, the root scripts, a new package or subsystem, or a new decision updates the matching
  section of this file ("Commands", "Repo map", "Reference package") or adds a note to `docs/decisions/`, in the same
  change.

## Rule: grep-friendly code

Mandatory, no exceptions. Applies to `packages/` and `apps/`; ESLint checks all of it except names built from strings.

- Named exports only: `export { StorageDriverS3 } from './lib/driver.js'`, types with `export type { … }`.
- No `export * from`: list the names, so a grep for a name finds where it is exported.
- No `export default`. Exceptions: Next files under `apps/*/app/**` and `*.config.*`, where the tool demands it.
- No renaming on export (`export { a as b }`): one symbol, one name.
- No dynamic `import()` outside tests, and no names built from strings. When `import()` is required (an optional peer,
  a Next runtime split), add `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
- No `process.env` in `packages/`, except `@novastarter/env`, `release-notes-generator` and `*.int.test.ts`. See
  "no application business logic in `packages/`".
- No imports from `apps/` or of an app package (`web`, `docs`) in `packages/`.
- Why: `docs/decisions/0004-named-exports-only.md`.

## Rule: strict types

Mandatory, no exceptions. ESLint checks all of it.

- `any` is forbidden everywhere, tests included. Use a real type, `unknown` with narrowing, `Partial<T>` or
  `vi.mocked()`.
- `@ts-ignore` and `@ts-nocheck` are forbidden. `@ts-expect-error` only with a description:
  `// @ts-expect-error -- the option is checked at runtime`.
- JSDoc presence (see "comment all code") is checked by `eslint-plugin-jsdoc`, in tests too.

## Rule: comment all code

Mandatory, no exceptions. Applies to every file: `packages/`, `apps/`, tests, scripts, configs.

A reader must understand what the code does and why without opening neighbouring files.

**JSDoc** above every class, method and member (private too), constructor, module-level function and function-valued
`const`, and every exported type or `const`. ESLint (`jsdoc/require-jsdoc`) checks presence; callbacks passed as
arguments and helpers declared inside a function body need none.

- The first line is one sentence: what the symbol does. Non-obvious behaviour or constraints go in a paragraph after it.
- Tags: `@param` for every argument, `@returns`, `@throws`, `@typeParam` for generics, `@defaultValue` for default
  constants, `@example` for public API, `@internal` for private members. Link symbols with `{@link OtherSymbol}`.

**Comments inside a function body:**

- Only where the code does not say it itself: why it is done this way, a constraint, a non-obvious consequence, a link to
  a protocol or bug.
- No numbering (`// 1.`, `// 2.`): the step order is visible from the code. ESLint (`local/no-numbered-comments`)
  rejects it.
- A comment that retells the code ("Create the set", "Return the result") is deleted. In a "what + why" comment, keep
  only the why.

```ts
/**
 * Top the bucket back up for the time elapsed since the previous refill.
 *
 * @internal
 */
private refill(): void {
	// A monotonic clock, so NTP corrections cannot hand out free tokens
	const now = performance.now();
	const elapsed = (now - this.lastRefill) / 1000;

	// Fractions are kept so a slow rate never rounds down to zero
	this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
	this.lastRefill = now;
}
```

**Do not:** write banners or decorative blocks (`====`, `----`, `****`); put a comment after code on the same line;
translate code into English (`// Increment the counter` above `counter++`). Why: `docs/decisions/0006`.

## Rule: errors

Mandatory, no exceptions.

- A mistake in driver, manager or location configuration throws `InvalidConfigError` from `@novastarter/errors` (code
  `INVALID_CONFIG`). The message names the subject and what to do: `The mysql database driver needs a "connection"`.
- An error the caller may branch on (bad input, a provider answer, a limit) is a class of the kit with a code.
- A plain `Error` only for a broken invariant or a programming mistake nobody catches; its message still names the
  package and the cause.
- Why: `docs/decisions/0007-config-errors.md`.

## Rule: check existing packages first

Mandatory, no exceptions.

Before writing a utility, helper, driver or anything else:

1. Check whether something suitable already exists in the existing packages (`packages/`, `apps/`, dependencies in
   `package.json`).
2. Found it — use it. Do not write your own version.
3. Not found — do not write it right away. First propose: what exactly to build and in which package/file. Write only
   after confirmation.

## Rule: dependency versions only via catalog:

Mandatory, no exceptions.

- Versions of all external dependencies live in the root `pnpm-workspace.yaml` under the `catalog:` section.
- In the `package.json` of packages and apps, external dependencies are declared as `"dependency": "catalog:"`. No
  versions inline.
- When an app needs a different version of a tool than the packages — TypeScript, `@types/node` — it lives in a named
  catalog under `catalogs:` and is declared as `"dependency": "catalog:<name>"`. Still no versions inline.
- Internal monorepo packages are linked as `"@novastarter/name": "workspace:*"`.
- Native dependencies (with a postinstall build) are allowed via `allowBuilds` in `pnpm-workspace.yaml`.
- `pnpm check:catalog` checks all of this, peer dependencies included; lefthook runs it when a `package.json` is staged.

## Rule: never create a new package on your own

Mandatory, no exceptions.

- When a task seems to need a new package in `packages/`, do not create it. Not a stub, not a draft, not "to be filled in
  later".
- Propose the implementation instead and wait for confirmation:
  - the package name and what it is for;
  - why no existing package can take it (see "check existing packages first");
  - its public API: the exported functions, classes and types;
  - its external dependencies and the internal packages it builds on;
  - for a subsystem, its driver / manager / factory layout and the drivers it ships with.
- Only after the user confirms is the package created, following "build new packages from the existing template".

## Rule: build new packages from the existing template

Mandatory, no exceptions.

- Do not invent your own structure. Copy the reference package (see "Reference package"): `package.json`, `exports`,
  the `build`, `dev`, `test`, `test:coverage` scripts, `src/index.ts` and so on.
- A new storage driver is always a separate package.
- Subsystems follow the single driver / manager / factory convention. A new subsystem repeats it rather than introducing
  its own.

## Rule: tests sit next to the code, integration tests are marked and skip without their service

Mandatory, no exceptions.

- A unit test is `<name>.test.ts` next to `<name>.ts`, one file per module: a driver gets its own test file, not a
  shared one for the library it wraps.
- A test that runs a module with its real dependencies — the other modules of the package unmocked, or a real backend —
  is `<name>.int.test.ts` next to the module it starts from.
- A test that needs a running service reads its address from the environment and skips without it:
  `describe.skipIf(!process.env['REDIS'])(…)`. `pnpm test` stays green on a machine with nothing running; the service is
  what turns the suite on. Clients are opened inside `beforeAll`, never in the `describe` body, which runs at collection
  even when the suite is skipped.

## Rule: no application business logic in `packages/`

Mandatory, no exceptions.

- `packages/` holds what any application could reuse: drivers, managers, contracts, utilities. Nothing in it knows a
  particular application's domain, routes, jobs, templates, variables or defaults.
- What belongs to one application — its env schema, its location configs, the drivers it ships with, its job handlers,
  its mail templates and routes — lives in that application under `apps/<name>/`.
- A package takes its configuration as arguments; it does not read `process.env` itself (`@novastarter/env` is the one
  exception: reading it is its job) and registers no locations on its own.
- The test: code that changes when one application's product requirements change belongs in `apps/`; code that changes
  when a backend, protocol or library changes belongs in `packages/`.

## Rule: working on an app, ask before touching `packages/`

Mandatory, no exceptions.

- While the task is in `apps/<name>/`, a change to `packages/` is never made on the way. First ask, in one line, whether
  the same result can be reached inside `apps/<name>/` — a wrapper, a driver of the app's own, a location config, a
  handler — and wait for the answer.
- Only when the user confirms the package has to change is it changed, in a step of its own with its own changeset.
- The reason: `packages/` is shared by every application; a shortcut taken for one app becomes an API every other app
  has to live with.

## Rule: every change ships with a changeset

Mandatory, no exceptions.

- Any code change in `packages/` or `apps/` comes with a changeset: the file `.changeset/<kebab-name>.md`, written by
  hand (`pnpm changeset` is interactive). The Stop hook blocks the end of the reply until such a file exists, and the
  lefthook `pre-commit` job `changeset` rejects a commit that stages such changes without one.
- Without a changeset, code changes do not go out: not into a commit, not into a PR.
- Frontmatter: affected packages and the version bump (patch / minor / major).
- Body: one line of future release notes (`/release-notes` assembles them from changesets). In English, one sentence,
  for the person using the package: what now works differently and what they should do about it.
  - Fix — what now works: `S3 driver no longer truncates uploads larger than the part size`.
  - Breaking — what to change in calling code:
    `` `StorageManager.registerDriver` now takes a driver class instead of an instance; pass the class ``.
  - Dependency update — name, version and what it fixes: `Electron 43.7.0 fixes a glibc use-after-free`.
  - Too little: `Init fixes`, `Fix bug`, `Refactor`.
