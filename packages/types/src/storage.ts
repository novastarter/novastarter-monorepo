/**
 * Byte range requested from a stored object.
 *
 * Both bounds are inclusive and optional. Drivers forward the pair to their backend as-is, so an omitted `start`
 * follows the backend's convention: the HTTP `Range` header S3 receives treats `end` alone as a suffix range.
 */
export interface Range {
	/** Zero-based offset of the first byte to read; omitted, the start follows the backend's convention. */
	start?: number | undefined;
	/** Zero-based offset of the last byte to read; omitted, the read goes until the end. */
	end?: number | undefined;
}

/**
 * Metadata a storage driver reports for a single object.
 */
export type Stat = {
	/** Object size in bytes. */
	size: number;
	/** Moment the object was last written. */
	modified: Date;
};

/**
 * Options accepted by a driver's `read` operation.
 */
export type ReadOptions = {
	/** Partial read; the whole object is streamed when omitted. */
	range?: Range | undefined;
	/** Backend-specific object version to read; ignored by drivers without versioning. */
	version?: string | undefined;
};

/**
 * State shared between the steps of a resumable (TUS) upload.
 *
 * The context is created once per upload and handed back to the driver on every later call, so a driver can keep
 * backend-specific handles in `metadata` (for example an S3 multipart upload id) without holding state of its own.
 */
export type ChunkedUploadContext = {
	/** Total upload size in bytes; unknown while the client defers the length. */
	size?: number | undefined;
	/** Key/value pairs sent by the client plus anything the driver adds; `null` marks a key sent without a value. */
	metadata: Record<string, string | null> | undefined;
};
