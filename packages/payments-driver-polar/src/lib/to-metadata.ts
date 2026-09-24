/**
 * Polar's metadata as the kit's: every value a string.
 *
 * Polar stores strings, numbers and booleans; the kit's shapes carry strings only, so a number or a boolean is
 * written out the way `String()` does.
 *
 * @param metadata - Polar's, or nothing.
 * @returns The same keys with string values.
 */
export const toMetadata = (
	metadata: Record<string, string | number | boolean> | null | undefined,
): Record<string, string> => {
	// Polar answers `null` for no metadata; an empty object keeps the kit's shapes free of nullable metadata
	return Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, String(value)]));
};
