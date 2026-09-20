import type { CustomData } from '@paddle/paddle-node-sdk';

/**
 * Paddle's custom data as the kit's metadata: every value a string, nested values written out as JSON.
 *
 * Paddle stores any JSON under `custom_data`; the kit's shapes carry flat strings, so a number or a boolean is
 * written the way `String()` does and an object or an array as its JSON text — the kit itself writes only strings
 * (`organizationId`, `planId`, `period`), so those come back unchanged.
 *
 * @param customData - Paddle's, or nothing.
 * @returns The same keys with string values.
 */
export const toMetadata = (customData: CustomData | null | undefined): Record<string, string> =>
	Object.fromEntries(
		Object.entries(customData ?? {}).map(([key, value]) => [
			key,
			typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
		]),
	);
