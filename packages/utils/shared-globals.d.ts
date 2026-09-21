/**
 * The host globals the shared entry point is allowed to use.
 *
 * `tsconfig.shared.json` type-checks `src` (minus `src/node`) without `@types/node` and without the `DOM` lib, so a
 * stray `process`, `window` or `fetch` fails the check instead of failing at runtime on the other platform. The ES
 * lib alone declares no timers and no abort signals, though, and `sleep`, `retry` and `withTimeout` need them — every
 * runtime provides them, so the minimum those helpers use is declared here, and nothing more.
 *
 * Only that tsconfig includes this file: `tsconfig.json` and the tsdown build see `@types/node`, whose declarations
 * these would clash with.
 */

declare function setTimeout(callback: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;

interface AbortSignal {
	readonly aborted: boolean;
	readonly reason: any;
	addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
	removeEventListener(type: 'abort', listener: () => void): void;
}

declare class AbortController {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
}
