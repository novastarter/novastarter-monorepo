/**
 * Whether a value is a phone number in E.164: a `+`, then 2 to 15 digits, the first not `0`.
 *
 * @param value - Free text.
 * @returns `true` for a number every provider takes as given.
 * @example
 * ```ts
 * isPhoneNumber('+14155550123');
 * // => true
 *
 * isPhoneNumber('415 555 0123');
 * // => false
 * ```
 */
export const isPhoneNumber = (value: string): boolean => {
	// 1. E.164 caps a number at 15 digits including the country code, which never starts with 0
	return /^\+[1-9]\d{1,14}$/.test(value);
};

/**
 * A phone number as people type it, brought to E.164 where that needs no guessing.
 *
 * Whitespace, dashes, dots and parentheses go, and an international `00` prefix becomes `+`. A bare digit string is
 * handed back as is: whether `4155550123` is a US number or one of the country the app runs in is the caller's
 * knowledge, not this function's — `sendSms()` refuses it, so the caller learns to pass the country code.
 *
 * @param value - The number as given.
 * @returns The number without separators, `+`-prefixed when the input said it was international.
 * @example
 * ```ts
 * normalizePhoneNumber('+1 (415) 555-0123');
 * // => '+14155550123'
 *
 * normalizePhoneNumber('0044 7700 900123');
 * // => '+447700900123'
 * ```
 */
export const normalizePhoneNumber = (value: string): string => {
	// 1. Separators carry no information; only the digits and a leading `+` do
	const compact = value.trim().replace(/[\s().-]/g, '');

	// 2. `00` is the international prefix of most countries; `+` is what E.164 and every provider expect instead
	return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
};
