/**
 * Public entry point of `@novastarter/logger`.
 *
 * One process-wide pino logger (`useLogger`, set by the application through `registerLogger`), the factories the
 * application builds loggers with from its own configuration (`createLogger`, `createHttpLogger` for HTTP servers)
 * and the bus-backed `LogsStream` that lets every instance of a deployment share its log lines; the two small helpers
 * (`redactQuery`, `resolveLogStyle`) are exported so consumers can apply the same rules to their own output. Pino's
 * `Logger` type is re-exported so a package typing a logger option needs no dependency on pino itself.
 */
export type { Logger } from 'pino';
export * from './lib/create-logger.js';
export * from './lib/create-http-logger.js';
export * from './lib/logs-stream.js';
export * from './lib/use-logger.js';
export * from './utils/redact-query.js';
export * from './utils/resolve-log-style.js';
