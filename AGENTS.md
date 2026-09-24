## Super-rule: English only

This rule overrides everything else and applies always and everywhere.

Everything is done and written in English: code, comments, docs, commit messages, changesets, PR titles and
descriptions, issues, file names, identifiers, error messages, logs, chat replies to the user, questions, plans.

**No other languages. No exceptions.** Input in another language is answered in English.

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
- The presence of JSDoc (see "comment all code") is checked by `eslint-plugin-jsdoc`, in tests too. Callbacks passed as
  arguments (`it(…, () => …)`, `map((x) => …)`) and helpers declared inside a function body need none: the enclosing
  function's numbered comment explains them.

## Rule: comment all code

This rule applies always and everywhere:

- `packages/`
- `apps/`
- `tests/`
- scripts
- TypeScript/JavaScript configs
- new code
- modified code
- exported code
- internal code
- public API
- private API
- production code
- temporary code

**There are no exceptions.**

A person reading the code must understand **what the code does and why it is done this way** without opening
neighbouring files.

### Comment format

#### 1. Full JSDoc above every export

JSDoc is mandatory above:

- `class`
- `function`
- `const`
- `type`
- every class method
- `constructor`
- private methods
- private members, where JSDoc applies to them

The first line of the JSDoc is **one sentence** describing what the symbol does.

If the behaviour or constraints are not obvious, a separate paragraph explaining the behaviour and constraints follows
the first line.

Use the matching JSDoc tags:

- `@param` — for every argument
- `@returns` — for the return value
- `@throws` — for errors the function may throw
- `@typeParam` — for generic parameters
- `@defaultValue` — for constants holding a default value
- `@example` — for public API
- `@internal` — for private/internal members

Reference other symbols with `{@link OtherSymbol}`.

#### 2. Numbered comments inside function bodies

Inside every function, every logical block must have a comment before it.

Format:

```ts
// 1. Describe what this step does and why
// 2. Describe the next logical step and why
// 3. Describe the next logical step and why
```

Numbering:

- starts at `1` for every function;
- runs sequentially;
- must have no gaps;
- every number goes **before its logical block**.

The comment must explain not only **what** happens but also **why** it is done this particular way.

#### 3. Comment language

All comments are written **in English**, like the rest of the code in `packages/`.

### Example

````ts
/**
 * Retry settings applied when the caller passes none.
 *
 * @defaultValue 3 repeats, 100 ms base delay, 5 s ceiling.
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
	retries: 3,
	baseDelay: 100,
	maxDelay: 5_000,
};

/**
 * Rate limiter that hands out a fixed number of tokens per second.
 *
 * The bucket starts full and refills continuously up to its capacity, so short bursts are allowed while the long-run
 * average stays at `refillPerSecond`.
 *
 * @example
 * ```ts
 * const bucket = new TokenBucket(10, 2);
 *
 * if (!bucket.consume()) {
 *     throw new Error('Rate limit exceeded');
 * }
 * ```
 */
export class TokenBucket {
	private tokens: number;
	private lastRefill: number;

	/**
	 * Create a bucket that starts out full.
	 *
	 * @param capacity - Largest burst the bucket will ever allow.
	 * @param refillPerSecond - Tokens added back every second.
	 */
	constructor(
		private readonly capacity: number,
		private readonly refillPerSecond: number,
	) {
		this.tokens = capacity;
		this.lastRefill = performance.now();
	}

	/**
	 * Take tokens from the bucket.
	 *
	 * @param count - Number of tokens the caller wants.
	 * @returns `true` when the tokens were deducted, `false` when the budget was insufficient.
	 */
	consume(count = 1): boolean {
		// 1. Account for the time passed since the previous call
		this.refill();

		// 2. Reject the request outright when the budget is short
		if (this.tokens < count) {
			return false;
		}

		// 3. Charge the request and let it through
		this.tokens -= count;

		return true;
	}

	/**
	 * Top the bucket back up for the time elapsed since the previous refill.
	 *
	 * @internal
	 */
	private refill(): void {
		// 1. Measure the gap on a monotonic clock, so NTP corrections cannot hand out free tokens
		const now = performance.now();
		const elapsed = (now - this.lastRefill) / 1000;

		// 2. Nothing to add within the same tick
		if (elapsed <= 0) {
			return;
		}

		// 3. Credit the elapsed time, keeping fractions so a slow rate never rounds down to zero
		this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
		this.lastRefill = now;
	}
}

/**
 * Run an operation again with exponential backoff until it succeeds or the retry budget runs out.
 *
 * @typeParam T - Value the operation resolves to.
 * @param fn - Operation to run. Called at least once.
 * @param options - Partial overrides merged over {@link DEFAULT_RETRY_OPTIONS}.
 * @returns The first successful result.
 * @throws The error raised by the final attempt.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
	// 1. Caller overrides win over the defaults
	const { retries, baseDelay, maxDelay } = { ...DEFAULT_RETRY_OPTIONS, ...options };

	let lastError: unknown;

	// 2. One call plus `retries` repeats, hence the inclusive bound
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			// 3. Remember the failure — it becomes the thrown error once the budget is spent
			lastError = error;

			// 4. Out of budget: stop without sleeping for nothing
			if (attempt === retries) {
				break;
			}

			// 5. Double the wait each round, capped, then jitter it to break up synchronised clients
			const backoff = Math.min(maxDelay, baseDelay * 2 ** attempt);
			await sleep(backoff * (0.5 + Math.random() / 2));
		}
	}

	// 6. Every attempt failed — surface the most recent reason
	throw lastError;
}
````

### What not to do

Do not add comments that merely repeat the code.

Bad:

```ts
// Increment the counter
counter++;
```

Such a comment explains nothing, because `counter++` is already obvious.

Also forbidden:

- full-width separator/banner comments;
- large decorative blocks of `====`, `----`, `*****` and the like;
- trailing comments after code on the same line.

Bad:

```ts
counter++; // Increment counter
```

Comments must explain **logic, intent, reason or constraint**, not translate the code into English.

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
- A `peerDependencies` entry that uses a version range today may keep it.
- `pnpm check:catalog` checks all of this; lefthook runs it when a `package.json` is staged.

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
