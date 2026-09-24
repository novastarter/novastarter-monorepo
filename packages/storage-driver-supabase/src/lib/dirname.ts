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
	// A bare name has one segment, so it yields an empty string
	return path.split('/').slice(0, -1).join('/');
}
