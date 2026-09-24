/**
 * Public entry point of `@novastarter/storage`.
 *
 * Object storage in three parts: the {@link StorageDriver} contract, with {@link TusDriver} for the drivers that
 * take resumable uploads (the drivers themselves live in the `@novastarter/storage-driver-*` packages), the
 * {@link StorageManager} of {@link useStorage} mapping named locations to drivers, and the types every driver
 * speaks — {@link Stat}, {@link ReadOptions}, {@link ChunkedUploadContext}.
 */
export type { StorageDriver, TusDriver } from './driver.js';
export { StorageFileNotFoundError, type StorageFileNotFoundErrorExtensions } from './errors/index.js';
export { toListPrefix, toRelativePath } from './lib/keys.js';
export { StorageManager, type StorageDrivers } from './lib/storage-manager.js';
export { supportsTus } from './lib/supports-tus.js';
export { useStorage } from './lib/use-storage.js';
export type { ChunkedUploadContext, Range, ReadOptions, Stat } from './types.js';
