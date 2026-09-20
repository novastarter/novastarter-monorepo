/**
 * dirname implementation that always uses '/' to split and returns '' in case of no separator present.
 *
 * `node:path`'s `dirname` would return `.` for a bare name and use the platform separator, neither of which suits
 * Supabase object names.
 *
 * @param path - Object name or prefix.
 * @returns Everything before the last `/`, or an empty string.
 */
export function dirname(path: string): string {
	// 1. Drop the last segment and rejoin with `/`; a bare name has one segment, so this yields an empty string
	return path.split('/').slice(0, -1).join('/');
}
