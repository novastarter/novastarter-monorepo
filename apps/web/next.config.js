/** @type {import('next').NextConfig} */
const nextConfig = {
	// The Node-only dependencies of the kit run on the server as plain Node modules rather than through the bundler:
	// pino spawns worker threads, ioredis and bullmq open sockets, nodemailer opens SMTP sockets and spawns sendmail,
	// pg opens sockets and optionally requires the native pg-native, PGlite finds its WebAssembly and data bundle next
	// to its own module through `import.meta.url`, reads them with `fs` and imports its Node filesystem dynamically.
	// The workspace packages themselves are bundled — Turbopack only externalises packages installed under
	// node_modules — which is fine, they are plain ESM
	serverExternalPackages: ['@electric-sql/pglite', 'bullmq', 'ioredis', 'nodemailer', 'pg', 'pino', 'pino-pretty'],
};

export default nextConfig;
