---
'@novastarter/utils': minor
'@novastarter/storage': minor
'@novastarter/memory': minor
'@novastarter/redis': minor
'@novastarter/logger': minor
'@novastarter/env': minor
'@novastarter/types': minor
'@novastarter/validation': minor
'@novastarter/pressure': minor
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-supabase': patch
'@novastarter/constants': patch
'@novastarter/errors': patch
---

Every subsystem is now wired explicitly by the application at start-up through one registration shape — `DriverManager` of `@novastarter/utils`: `registerDriver(name, Class)`, `registerLocation(name, { driver, options })` with `options` typed by the driver map each package declares (`StorageDrivers`, `QueueDrivers`, `KvDrivers`, …, augmentable with `declare module`), and `location(name)` building the driver on first use — and no package reads the environment any more: `@novastarter/env` drops `getConfigFromEnv`, the type map, type guessing, the Directus defaults and the list of known variables, so a value without a cast prefix stays what its source gave it, the application's zod schema types it and names the variables that may come from a `<NAME>_FILE` (`useEnv({ fileVariables })`, see `apps/web/env.ts`); `@novastarter/redis` replaces `useRedis(name)` with `useRedis().registerLocation(name, url | options)` / `.location(name)` and `createRedis(name)` with `createRedis(url | options, overrides)`, dropping `redisConfigAvailable`, `getRedisLocations` and `getRedisPrefix`; `@novastarter/logger` takes `level`, `style`, `levels` and `pino` as options of `createLogger`, mounts `createHttpLogger({ logger, ignorePaths, http })` as a child of that logger and lets the application register the process logger with `registerLogger`; `@novastarter/memory` replaces `createKv` / `createCache` / `createBus` / `createLimiter` and `defineCache` with the `useKv` / `useCache` / `useBus` / `useLimiter` managers and drops the `type` discriminant from the driver options (`KvLocalOptions`, `KvRedisOptions`, …); `@novastarter/storage` adds `useStorage()` and rebuilds `StorageManager` on `DriverManager`, each driver package registering its options in `StorageDrivers`; `@novastarter/validation` gains `zodErrorToErrorExtensions`; `Range` of `@novastarter/types` takes optional bounds; `@novastarter/rate-limiter` is renamed `@novastarter/pressure` (`PressureMonitor`, `handlePressure`); `apps/web` boots the kit from `config/*.ts` in `bootstrap.ts` through `instrumentation.ts`; every package's readme documents installation and usage.
