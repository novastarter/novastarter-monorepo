/**
 * The id of a Stripe reference that may be expanded: the string itself, or the `id` of the object it expanded to.
 *
 * @param reference - A string id, an expanded object with an `id`, or nothing.
 * @returns The id, or `null` when there is no reference.
 */
export const idOf = (reference: string | { id: string } | null | undefined): string | null => {
	// A missing reference is `null`, so callers can store it as a nullable column without a second check.
	if (reference === null || reference === undefined) return null;

	// Stripe hands back either the id or the expanded object, depending on the request's `expand`.
	return typeof reference === 'string' ? reference : reference.id;
};
