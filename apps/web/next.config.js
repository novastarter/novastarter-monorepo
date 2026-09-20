/** @type {import('next').NextConfig} */
const nextConfig = {
	// The Node-only dependencies of the kit run on the server as plain Node modules rather than through the bundler:
	// pino spawns worker threads, ioredis and bullmq open sockets. The workspace packages themselves are bundled —
	// Turbopack only externalises packages installed under node_modules — which is fine, they are plain ESM
	serverExternalPackages: ['bullmq', 'ioredis', 'pino', 'pino-pretty'],
};

export default nextConfig;
