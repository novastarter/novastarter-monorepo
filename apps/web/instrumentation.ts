/**
 * Next.js instrumentation hook: runs once when the server starts, before any request.
 *
 * Only the Node.js runtime boots the kit — the edge runtime has neither Redis nor a filesystem — and the bootstrap is
 * imported dynamically, so its Node-only dependencies never enter the edge bundle.
 */
export const register = async (): Promise<void> => {
	// 1. The hook is called for every runtime Next.js builds; the kit belongs to the Node.js one alone
	if (process.env['NEXT_RUNTIME'] !== 'nodejs') {
		return;
	}

	// 2. Load and run the bootstrap only now, keeping the import out of the edge and client bundles
	const { bootstrap } = await import('./bootstrap');
	const env = bootstrap();

	// 3. With `DATABASE_MIGRATE` the pending migrations run before the first request; a failure fails the start. The
	//    import stays dynamic for the same reason as above
	if (env.DATABASE_MIGRATE) {
		const { migrateDatabase } = await import('./db/migrate');

		await migrateDatabase();
	}
};
