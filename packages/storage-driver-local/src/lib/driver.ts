import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Dir } from 'node:fs';
import { copyFile, mkdir, open, opendir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import stream, { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { useLogger } from '@novastarter/logger';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	type TusDriver,
} from '@novastarter/storage';
import { normalizePath } from '@novastarter/utils';

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
	 * The file is opened lazily, so a missing file is not reported by this call but on the stream: it is destroyed with
	 * the {@link StorageFileNotFoundError} the other drivers throw up front, carrying the `node:fs` error as `cause`.
	 * Any other failure reaches the stream as `node:fs` reported it.
	 *
	 * @param filepath - File path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns A stream over the file, or over the requested range of it.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		const streamOptions: Parameters<typeof createReadStream>[1] = {};

		// 1. Only forward the bounds that were given, so the stream keeps its own defaults (start of file, end of
		//    file) for the missing side. Both bounds are inclusive, matching `createReadStream`, and both are checked
		//    for presence rather than truthiness: `end: 0` asks for the first byte, not for the whole file
		if (range?.start !== undefined) {
			streamOptions.start = range.start;
		}

		if (range?.end !== undefined) {
			streamOptions.end = range.end;
		}

		// 2. The file stream reports a missing file as an error event once it tries to open the file; that event is
		//    translated into the error every backend shares on the stream handed out, so a consumer tells a missing file
		//    from a failed read the same way it does with the other drivers. The two are tied with `pipeline`, not
		//    `pipe`: a consumer that destroys the stream it was handed — a client gone mid-download — then destroys the
		//    file stream too and frees its descriptor, where `pipe` would only pause it and keep the file open
		const source = createReadStream(this.fullPath(filepath), streamOptions);
		const output = new PassThrough();

		source.on('error', (error: NodeJS.ErrnoException) => {
			// 1. Only the errors that prove the file cannot exist are translated: ENOENT is the plain case, ENOTDIR means
			//    a parent of the path is a file. Registered before `pipeline` adds its own handler, so the translated
			//    error is the one the consumer sees
			const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';

			output.destroy(missing ? new StorageFileNotFoundError({ filepath }, { cause: error }) : error);
		});

		stream.pipeline(source, output, () => {
			// 1. The outcome already reached the consumer through `output`; nothing is left to report here
		});

		return output;
	}

	/**
	 * Read a file's size and last-modified time.
	 *
	 * @param filepath - File path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when there is no file at the path; a directory of that name does not count.
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

		// 3. A directory has a size and an `mtime` too, but no `read()` can ever stream it (`EISDIR`); reporting it
		//    would answer for something that is not an object, so it reads as missing, the way the object stores answer
		//    for a prefix
		if (!fileStat.isFile()) {
			throw new StorageFileNotFoundError({ filepath });
		}

		// 4. `mtime` is the closest match to "modified": `ctime` also moves on permission changes
		return {
			size: fileStat.size,
			modified: fileStat.mtime,
		};
	}

	/**
	 * Check whether a file is present.
	 *
	 * @param filepath - File path relative to the root.
	 * @returns `true` when the path exists and is a file, `false` when it cannot exist or is a directory.
	 * @throws Any other failure, such as a permission error, since it says nothing about the file.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. `stat` proves both presence and file-ness: `access` alone would also resolve for a directory, which no
		//    `read()` can stream
		try {
			const fileStat = await stat(this.fullPath(filepath));

			return fileStat.isFile();
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
	 * The data goes to a temporary sibling first and is renamed over the target once the whole stream went through, so
	 * a source that fails mid-way leaves the previous content in place instead of a truncated file under the final name.
	 *
	 * @param filepath - File path relative to the root.
	 * @param content - Data to store.
	 * @throws The error raised by the source, the write stream or the final rename; the temporary file is removed
	 * before it is rethrown.
	 */
	async write(filepath: string, content: Readable): Promise<void> {
		const fullPath = this.fullPath(filepath);

		// 1. `createWriteStream` does not create parent directories, so the destination folder is made first
		await this.ensureDir(dirname(fullPath));

		// 2. A temporary sibling in the same directory keeps the final `rename` on one filesystem, which is what makes
		//    it atomic; the random suffix keeps two concurrent writes of the same path from sharing one temporary file
		const tempPath = `${fullPath}.${randomBytes(6).toString('hex')}.tmp`;

		// 3. `pipeline` handles backpressure and rejects on an error from either side, so a failed write surfaces to
		//    the caller instead of leaving a dangling stream; the publishing rename sits in the same `try`, so a
		//    failure there — a cross-device target, a directory in the way, `EPERM` — rethrows with the temporary file
		//    removed instead of leaving it on disk forever
		try {
			await pipeline(content, createWriteStream(tempPath));

			// 4. `rename` replaces the target in one step, so a concurrent reader sees either the old content or the
			//    new one, never a mix, and the object-store rule "a failed write stores nothing" holds here too
			await rename(tempPath, fullPath);
		} catch (error) {
			// 5. The partial file is removed so nothing of the failed write stays on disk; a failure of the cleanup itself
			//    is ignored, since the write error is the one the caller needs to see
			try {
				await unlink(tempPath);
			} catch {
				// 6. Nothing to do: the temporary file either is gone already or cannot be removed right now
			}

			throw error;
		}
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
	 * @returns File paths relative to the root, produced lazily; nothing when the directory the prefix points into does
	 * not exist, the root included before the first write.
	 * @throws The `node:fs` error when a directory cannot be read for a reason other than being absent, such as a
	 * permission error.
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

		let directory: Dir;

		// 2. A directory that is not there — the root before the first write, a folder nobody wrote to — or a path
		//    running through a file (ENOTDIR) holds no files, so the listing ends empty as it does on an object store
		//    with no keys under the prefix. Anything else says nothing about the files and is rethrown
		try {
			directory = await opendir(prefixDirectory);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;

			if (code === 'ENOENT' || code === 'ENOTDIR') return;

			throw error;
		}

		for await (const file of directory) {
			// 3. A `write()` in flight stages its bytes in a `<name>.<random>.tmp` sibling of the target; yielding it
			//    would hand a concurrent caller a path that vanishes the moment the write publishes its rename, so the
			//    driver's own staging files are skipped
			if (/\.[0-9a-f]{12}\.tmp$/.test(file.name)) continue;

			const fileName = join(prefixDirectory, file.name);

			// 4. Exact, case-sensitive comparison: object stores match prefixes byte-for-byte, and a case-insensitive
			//    filesystem resolves case only when looking up a concrete path, so a listing must not fold case either
			if (fileName.startsWith(prefix) === false) continue;

			// 5. Only files are yielded, in the root-relative form callers pass in, with forward slashes whatever the
			//    platform separator is, since the contract speaks in forward slashes
			if (file.isFile()) {
				yield normalizePath(relative(this.root, fileName));
			}

			// 6. Recurse with a trailing separator, so the nested call walks the whole directory rather than treating
			//    its name as a partial prefix
			if (file.isDirectory()) {
				yield* this.listGenerator(join(fileName, sep));
			}
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// 1. Only the extensions the chunked-upload methods back are advertised: `creation` maps to
		//    `createChunkedUpload`, `termination` to `deleteChunkedUpload`, and `expiration` lets the server announce
		//    when an unfinished upload may be discarded. Checksum and concatenation are left out because a chunk is
		//    written at its offset without a verification step, and chunks of several uploads cannot be joined into one
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
	 * @throws StorageFileNotFoundError when the file does not exist, meaning the upload was never created here or its
	 * file is gone; the file system's error is kept as the cause.
	 * @throws Error naming the file and offset when the pipeline fails; the failure that caused it is logged as a
	 * warning and carried as the error's `cause`.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		_context: ChunkedUploadContext,
	): Promise<number> {
		const fullPath = this.fullPath(filepath);

		let fileHandle: Awaited<ReturnType<typeof open>>;

		// 1. `r+` opens for writing without truncating, so the bytes before the chunk's offset stay intact. A missing
		//    file means the upload was never created here or its file is gone; only the errors that prove the path
		//    cannot exist become the kit's "not found" — ENOENT is the plain case, ENOTDIR means a parent of the path
		//    is a file — the way `read` and `stat` translate the same errors, so a chunk for an unknown upload fails
		//    like a stat on it would
		try {
			fileHandle = await open(fullPath, 'r+');
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;

			if (code === 'ENOENT' || code === 'ENOTDIR') {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 2. `start` positions the stream, so the chunk lands at its offset while the bytes before it stay intact
		const writeable = fileHandle.createWriteStream({
			start: offset,
		});

		let bytesReceived = 0;

		// 3. A pass-through transform counts the bytes as they flow, because neither the readable nor the write
		//    stream reports how much actually went through
		const transform = new stream.Transform({
			transform(chunk, _, callback) {
				// 1. Count first, then hand the chunk on unchanged; the stream is only tapped, never altered
				bytesReceived += chunk.length;
				callback(null, chunk);
			},
		});

		// 4. The callback form of `pipeline` is used so the byte count can be read once every stream has finished
		return new Promise<number>((resolve, reject) => {
			stream.pipeline(content, transform, writeable, (err) => {
				// 1. The rejection carries a real error naming the file and offset: the TUS server maps any rejection
				//    to a generic failure and the client resumes from the offset it last had confirmed, while callers
				//    inspecting `error.message` get a readable reason. The cause is logged, so a failing disk does not
				//    go unnoticed
				if (err) {
					const message = `Local storage failed to write a chunk of "${filepath}" at offset ${offset}`;

					useLogger().warn(err, message);

					return reject(new Error(message, { cause: err }));
				}

				// 2. Only bytes that went through the pipeline count; a chunk cut short by an error never reaches here
				offset += bytesReceived;

				return resolve(offset);
			});
		});
	}
}
