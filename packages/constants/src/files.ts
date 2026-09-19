/**
 * File extensions that are loaded as JavaScript modules.
 *
 * Used to decide whether a configuration or extension file has to be `require`d instead of parsed as text.
 *
 * @defaultValue `['js', 'mjs', 'cjs']`
 */
export const JAVASCRIPT_FILE_EXTS = ['js', 'mjs', 'cjs'] as const;

/**
 * Size in bytes of one part in a chunked (resumable) upload.
 *
 * @defaultValue 8 MiB, `8_388_608` bytes.
 */
export const DEFAULT_CHUNK_SIZE = 8_388_608;
