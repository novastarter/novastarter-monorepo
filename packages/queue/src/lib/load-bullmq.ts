/**
 * The memoised `bullmq` import, shared by every consumer of this module.
 *
 * @internal
 */
let bullmq: Promise<typeof import('bullmq')> | undefined;

/**
 * Load `bullmq` once, with the install hint its absence deserves.
 *
 * `bullmq` is an optional peer of the package: a deployment on the `local` driver never installs it, and Node's own
 * `Cannot find package 'bullmq'` would not say why the queue needs it, so a failed load is rethrown naming the
 * package to add. The promise is kept once settled — also when it rejected, since a missing package does not appear
 * mid-process — so every queue and worker of the process shares one load.
 *
 * @returns The module.
 * @throws Error naming the missing package when it is not installed.
 */
export const loadBullmq = (): Promise<typeof import('bullmq')> => {
	// 1. Memoised, so a process that opens several queues and workers pays for the import once
	// eslint-disable-next-line no-restricted-syntax -- optional peer: a static import would crash without it
	bullmq ??= import('bullmq').catch((error: unknown) => {
		throw new Error('Queue driver "bullmq" needs the "bullmq" package: pnpm add bullmq', { cause: error });
	});

	return bullmq;
};
