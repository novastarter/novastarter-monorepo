/**
 * Build a comparator that orders items by the position of one of their keys in an external list.
 *
 * Items missing from the list keep their relative order and sort after the listed ones, so a partial `order` only
 * pins the packages that matter and leaves the rest untouched.
 *
 * @typeParam T - Item type being sorted.
 * @typeParam O - List of key values in the desired order.
 * @typeParam K - Key of `T` that is looked up in `order`.
 * @param order - Key values in the desired order.
 * @param key - Which property of the item to look up.
 * @returns A comparator for `Array.prototype.sort`.
 */
export function sortByExternalOrder<T, O extends T[K][], K extends keyof T>(order: O, key: K): (a: T, b: T) => number {
	return (a, b) => {
		// 1. Both listed: the list decides
		const indexOfA = order.indexOf(a[key]);
		const indexOfB = order.indexOf(b[key]);
		if (indexOfA >= 0 && indexOfB >= 0) return indexOfA - indexOfB;

		// 2. Only `a` listed: it goes first
		if (indexOfA >= 0) {
			return -1;
		}

		// 3. Only `b` listed or neither: keep the existing order, so unlisted items are never shuffled
		return 0;
	};
}

/**
 * Build a comparator that orders items by the position of one of their keys among the values of an object.
 *
 * Used with the title maps from the config: an item whose title appears earlier in the map sorts first.
 *
 * @typeParam T - Item type being sorted.
 * @typeParam O - Object whose values define the order.
 * @typeParam K - Key of `T` that is looked up among the object values.
 * @param object - Object whose value order is the desired order.
 * @param key - Which property of the item to look up.
 * @returns A comparator for `Array.prototype.sort`.
 */
export function sortByObjectValues<T, O extends Record<any, T[K]>, K extends keyof T>(
	object: O,
	key: K,
): (a: T, b: T) => number {
	// 1. Object values keep insertion order, which is the order the config lists the titles in
	const order = Object.values(object);
	return (a, b) => order.indexOf(a[key]) - order.indexOf(b[key]);
}
