/**
 * The Next.js configuration of the web app: the Node-only dependencies of the kit run on the server as plain Node
 * modules rather than through the bundler, so the app externalises them.
 *
 * pino spawns worker threads, ioredis and bullmq open sockets, nodemailer opens SMTP sockets and spawns sendmail, pg
 * opens sockets and optionally requires the native pg-native, and PGlite finds its WebAssembly and data bundle next
 * to its own module through `import.meta.url`, reads them with `fs` and imports its Node filesystem dynamically. The
 * workspace packages themselves are bundled — Turbopack only externalises packages installed under node_modules —
 * which is fine, they are plain ESM.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
	serverExternalPackages: ['@electric-sql/pglite', 'bullmq', 'ioredis', 'nodemailer', 'pg', 'pino', 'pino-pretty'],
};

/**
 * The configuration Next.js loads: {@link nextConfig} with the Node-only packages externalised.
 *
 * @type {import('next').NextConfig}
 */
export default nextConfig;
