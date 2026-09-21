import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, opendir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import stream, { type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { useLogger } from '@novastarter/logger';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	type TusDriver,
} from '@novastarter/storage';

/**
 * Options accepted by {@link StorageDriverLocal}.
 */
export type StorageDriverLocalConfig = {
	/** Directory every path is placed under; relative values resolve against the process working directory. */
	root: string;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `local` has its
 * options checked against {@link StorageDriverLocalConfig}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		local: StorageDriverLocalConfig;
	}
}

/**
 * Storage driver backed by the local filesystem.
 *
 * Every operation maps onto a `node:fs` call under the configured root. Caller paths are pinned inside that root, so
 * `..` segments cannot reach outside it. Resumable (TUS) uploads write chunks straight into the final file at the
 * given offset, which is why no assembly step is needed at the end.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverLocal } from '@novastarter/storage-driver-local';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('local', StorageDriverLocal);
 * storage.registerLocation('uploads', {
 * 	driver: 'local',
 * 	options: {
 * 		root: env.STORAGE_LOCAL_ROOT,
 * 	},
 * });
 * ```
 */
export class StorageDriverLocal implements TusDriver {
	/**
	 * Absolute root directory every path is resolved against.
	 *
	 * @internal
	 */
	private readonly root: string;

	/**
	 * Create a driver rooted at the given directory.
	 *
	 * @param config - Root directory; the directory itself is created lazily on the first write.
	 * @throws Error when `root` is missing.
	 */
	constructor(config: StorageDriverLocalConfig) {
		// 1. Refuse a missing root up front: `resolve(undefined)` would silently pick the working directory
		if (!config.root) {
			throw new Error('The local storage driver needs a "root"');
		}

		// 2. Resolve once, so a relative root keeps pointing at the same directory even if the process later changes
		//    its working directory
		this.root = resolve(config.root);
	}

	/**
	 * Resolve a caller path to an absolute path inside the root.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The absolute path.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. Joining with the separator first makes the caller path absolute, which collapses any leading `..` segments
		//    at the filesystem root; only then is it appended to the driver root, so it can never escape it
		return join(this.root, join(sep, filepath));
	}

	/**
	 * Create a directory and any missing parents.
	 *
	 * @param dirpath - Absolute directory path.
	 * @internal
	 */
	private async ensureDir(dirpath: string) {
		// 1. `recursive` also makes the call succeed when the directory already exists, so no separate check is needed
		await mkdir(dirpath, { recursive: true });
	}

	/**
	 * Stream a file's contents.
	 *
	 * @param filepath - File path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns A read stream over the file, or over the requested range of it.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<ReadStream> {
		const { range } = options || {};

		const streamOptions: Parameters<typeof createReadStream>[1] = {};

		// 1. Only forward the bounds that were given, so the stream keeps its own defaults (start of file, end of
		//    file) for the missing side. Both bounds are inclusive, matching `createReadStream`
		if (range?.start) {
			streamOptions.start = range.start;
		}

		if (range?.end) {
			streamOptions.end = range.end;
		}

		return createReadStream(this.fullPath(filepath), streamOptions);
	}

	/**
	 * Read a file's size and last-modified time.
	 *
	 * @param filepath - File path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when there is no file at the path.
	 * @throws The `node:fs` error for any other failure, such as a permission error.
	 */
	async stat(filepath: string): Promise<Stat> {
		let fileStat: Awaited<ReturnType<typeof stat>>;

		// 1. Only the errors that prove the path cannot exist become the kit's "not found": ENOENT is the plain case,
		//    ENOTDIR means a parent of the path is a file. Anything else says nothing about the file and is rethrown
		try {
			fileStat = await stat(this.fullPath(filepath));
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;

			if (code === 'ENOENT' || code === 'ENOTDIR') {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 2. `stat` rejects rather than resolving empty, so this guard only covers a misbehaving filesystem; it is kept
		//    so callers always get either real numbers or an error
		if (!fileStat) {
			throw new StorageFileNotFoundError({ filepath });
		}

		// 3. `mtime` is the closest match to "modified": `ctime` also moves on permission changes
		return {
			size: fileStat.size,
			modified: fileStat.mtime,
		};
	}

	/**
	 * Check whether a file is present.
	 *
	 * @param filepath - File path relative to the root.
	 * @returns `true` when the path exists, `false` when it cannot exist.
	 * @throws Any other failure, such as a permission error, since it says nothing about the file.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. `access` with the default mode only tests presence, which is cheaper than a full `stat`
		try {
			await access(this.fullPath(filepath));
			return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;

			// 2. Only the errors that prove the path cannot exist mean "missing": ENOENT is the plain case, ENOTDIR
			//    means a parent of the path is a file, ENAMETOOLONG that no such name can exist. Reporting an unreadable
			//    path as absent would make callers act on a wrong answer
			if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG') return false;

			throw error;
		}
	}

	/**
	 * Move a file to a new path.
	 *
	 * @param src - Current file path.
	 * @param dest - Path to move the file to.
	 */
	async move(src: string, dest: string): Promise<void> {
		const fullSrc = this.fullPath(src);
		const fullDest = this.fullPath(dest);

		// 1. `rename` does not create parent directories, so the destination folder is made first
		await this.ensureDir(dirname(fullDest));
		await rename(fullSrc, fullDest);
	}

	/**
	 * Copy a file to a new path.
	 *
	 * @param src - File to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		const fullSrc = this.fullPath(src);
		const fullDest = this.fullPath(dest);

		// 1. `copyFile` does not create parent directories, so the destination folder is made first
		await this.ensureDir(dirname(fullDest));
		await copyFile(fullSrc, fullDest);
	}

	/**
	 * Write a stream to a file, replacing any existing content.
	 *
	 * @param filepath - File path relative to the root.
	 * @param content - Data to store.
	 */
	async write(filepath: string, content: Readable): Promise<void> {
		const fullPath = this.fullPath(filepath);

		// 1. `createWriteStream` does not create parent directories, so the destination folder is made first
		await this.ensureDir(dirname(fullPath));

		// 2. `pipeline` handles backpressure and rejects on an error from either side, so a failed write surfaces to
		//    the caller instead of leaving a dangling stream
		const writeStream = createWriteStream(fullPath);
		await pipeline(content, writeStream);
	}

	/**
	 * Remove a file.
	 *
	 * @param filepath - File path relative to the root.
	 * @throws The `node:fs` error when the file is missing, unlike object stores that answer a missing key with success.
	 */
	async delete(filepath: string): Promise<void> {
		const fullPath = this.fullPath(filepath);

		// 1. `unlink` rather than `rm`: it only removes files, so a directory passed by mistake fails instead of being
		//    wiped
		await unlink(fullPath);
	}

	/**
	 * Enumerate file paths under a prefix.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty. A prefix may end mid-name, in which
	 * case every entry whose path starts with it is returned.
	 * @returns File paths relative to the root, produced lazily.
	 */
	list(prefix = ''): AsyncGenerator<string> {
		// 1. Resolve the prefix once and hand the recursion an absolute path, so every level compares against the same
		//    string
		const fullPrefix = this.fullPath(prefix);
		return this.listGenerator(fullPrefix);
	}

	/**
	 * Walk the directory tree under an absolute prefix and yield matching files.
	 *
	 * @param prefix - Absolute path prefix; a trailing separator marks a directory to walk in full.
	 * @returns File paths relative to the root.
	 * @internal
	 */
	private async *listGenerator(prefix: string): AsyncGenerator<string> {
		// 1. A prefix without a trailing separator may end mid-name (`uploads/img` matching `uploads/image.png`), so
		//    the directory to scan is its parent; a trailing separator names the directory itself
		const prefixDirectory = prefix.endsWith(sep) ? prefix : dirname(prefix);

		const directory = await opendir(prefixDirectory);

		for await (const file of directory) {
			const fileName = join(prefixDirectory, file.name);

			// 2. Case-insensitive comparison, so the result is the same on case-insensitive filesystems (macOS,
			//    Windows) as on case-sensitive ones
			if (fileName.toLowerCase().startsWith(prefix.toLowerCase()) === false) continue;

			// 3. Only files are yielded, in the root-relative form callers pass in
			if (file.isFile()) {
				yield relative(this.root, fileName);
			}

			// 4. Recurse with a trailing separator, so the nested call walks the whole directory rather than treating
			//    its name as a partial prefix
			if (file.isDirectory()) {
				yield* this.listGenerator(join(fileName, sep));
			}
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 */
	get tusExtensions(): string[] {
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start a resumable upload by creating the empty target file.
	 *
	 * @param filepath - Final file path relative to the root.
	 * @param context - Client-supplied size and metadata.
	 * @returns The context unchanged; the driver keeps no state of its own between calls.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		const fullPath = this.fullPath(filepath);

		// 1. `writeFile` does not create parent directories, so the destination folder is made first
		await this.ensureDir(dirname(fullPath));

		// 2. The file must exist before the first chunk arrives: `writeChunk` opens it in `r+` mode, which fails on a
		//    missing file
		await writeFile(fullPath, '');

		return context;
	}

	/**
	 * Abort a resumable upload by removing the partially written file.
	 *
	 * @param filepath - Final file path relative to the root.
	 * @param _context - Unused; the file path is all this driver needs.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. Chunks are written straight into the final file, so removing that file discards the whole upload
		await this.delete(filepath);
	}

	/**
	 * Complete a resumable upload.
	 *
	 * Nothing to do: every chunk was written in place at its offset, so the file is already complete once the last
	 * chunk lands.
	 *
	 * @param _filepath - Unused.
	 * @param _context - Unused.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {}

	/**
	 * Write one chunk into the target file at the given offset.
	 *
	 * @param filepath - Final file path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the file where this chunk starts.
	 * @param _context - Unused; the offset is all this driver needs.
	 * @returns The new upload offset: `offset` plus the bytes written.
	 * @throws `undefined` when the pipeline fails; the rejection carries no error, so the TUS server answers with a
	 * generic failure. The error itself is logged as a warning.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		_context: ChunkedUploadContext,
	): Promise<number> {
		const fullPath = this.fullPath(filepath);

		// 1. `r+` opens for writing without truncating, and `start` positions the stream, so the chunk lands at its
		//    offset while the bytes before it stay intact
		const writeable = await open(fullPath, 'r+').then((file) =>
			file.createWriteStream({
				start: offset,
			}),
		);

		let bytesReceived = 0;

		// 2. A pass-through transform counts the bytes as they flow, because neither the readable nor the write
		//    stream reports how much actually went through
		const transform = new stream.Transform({
			transform(chunk, _, callback) {
				// 1. Count first, then hand the chunk on unchanged; the stream is only tapped, never altered
				bytesReceived += chunk.length;
				callback(null, chunk);
			},
		});

		// 3. The callback form of `pipeline` is used so the byte count can be read once every stream has finished
		return new Promise<number>((resolve, reject) => {
			stream.pipeline(content, transform, writeable, (err) => {
				// 1. The rejection carries no error on purpose (upstream behaviour): the TUS server maps any rejection to
				//    a generic failure and the client resumes from the offset it last had confirmed. The cause is logged,
				//    so a failing disk does not go unnoticed
				if (err) {
					useLogger().warn(err, `Local storage failed to write a chunk of "${filepath}" at offset ${offset}`);
					return reject();
				}

				// 2. Only bytes that went through the pipeline count; a chunk cut short by an error never reaches here
				offset += bytesReceived;

				return resolve(offset);
			});
		});
	}
}
