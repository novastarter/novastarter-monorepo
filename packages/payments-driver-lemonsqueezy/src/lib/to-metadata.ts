/**
 * A checkout's custom data as the kit's metadata: every value a string.
 *
 * Lemon Squeezy carries the checkout's `custom` values on every event of the order and the subscription it
 * created, under `meta.custom_data`; the kit writes strings there (`organizationId`, `planId`, `period`), anything
 * else is written out the way `String()` does, an object as its JSON text.
 *
 * @param customData - `meta.custom_data`, or nothing.
 * @returns The same keys with string values.
 */
export const toMetadata = (customData: Record<string, unknown> | null | undefined): Record<string, string> =>
	Object.fromEntries(
		Object.entries(customData ?? {}).map(([key, value]) => [
			key,
			typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
		]),
	);
