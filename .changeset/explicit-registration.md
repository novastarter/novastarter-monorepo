---
'@novastarter/utils': minor
'@novastarter/storage': minor
'@novastarter/memory': minor
'@novastarter/redis': minor
'@novastarter/logger': minor
'@novastarter/env': minor
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-supabase': patch
'@novastarter/constants': patch
'@novastarter/errors': patch
'@novastarter/rate-limiter': patch
'@novastarter/stores': patch
'@novastarter/types': patch
---

Every subsystem is now wired explicitly by the application at start-up through one registration shape — `DriverManager` of `@novastarter/utils`: `registerDriver(name, Class)`, `registerLocation(name, { driver, options })`, `location(name)`, with a `default` location answering for unregistered names — and no package reads the environment any more: `@novastarter/env` drops `getConfigFromEnv`; `@novastarter/redis` replaces `useRedis(name)` with `useRedis().registerLocation(name, url | options)` / `.location(name)` and `createRedis(name)` with `createRedis(url | options, overrides)`, dropping `redisConfigAvailable`, `getRedisLocations` and `getRedisPrefix`; `@novastarter/logger` takes `level`, `style`, `levels`, `pino`, `http` and `ignorePaths` as options of `createLogger` / `createHttpLogger` and the application registers the process logger with `registerLogger`; `@novastarter/memory` adds `useKv`, `useCache`, `useBus`, `useLimiter` managers; `@novastarter/storage` adds `useStorage()` and rebuilds `StorageManager` on `DriverManager`; every package's readme now documents installation and usage.
