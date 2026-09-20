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
- Internal monorepo packages are linked as `"@novastarter/name": "workspace:*"`.
- Native dependencies (with a postinstall build) are allowed via `allowBuilds` in `pnpm-workspace.yaml`.

## Rule: build new packages from the existing template

Mandatory, no exceptions.

- Do not invent your own structure. Copy the convention of the neighbouring packages in `packages/`: `package.json`,
  `exports`, the `build`, `dev`, `test`, `test:coverage` scripts, `src/index.ts` and so on.
- A new storage driver is always a separate package.
- Subsystems follow the single driver / manager / factory convention. A new subsystem repeats it rather than introducing
  its own.

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
