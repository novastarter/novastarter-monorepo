/**
 * Describe a thrown value in one line of text.
 *
 * A `catch` clause receives `unknown`: an `Error` most of the time, but a vendor SDK may throw a string, a number or
 * a plain object. An `Error` contributes its `message`, or its `name` when the message is empty, so a bare
 * `new Error()` still reads as `Error` — nothing else about it, since a stack or a cause does not belong in a
 * one-line description — and anything else is what `String()` makes of it, or the `[object Object]` tag
 * for a value `String()` cannot convert, such as an object without a prototype. This is the text a wrapped error's
 * message or a log line is built from, so it never throws itself.
 *
 * @param error - Whatever was thrown or rejected with.
 * @returns The message of an `Error` (its name when the message is empty), otherwise the value written as text.
 * @example
 * ```ts
 * toErrorMessage(new TypeError('boom'));
 * // => 'boom'
 *
 * toErrorMessage('boom');
 * // => 'boom'
 * ```
 */
export const toErrorMessage = (error: unknown): string => {
	// 1. An `Error` says what went wrong in its `message`; the stack is not part of the answer, and the class name
	//    only stands in when the message is empty, so the line never ends in nothing
	if (error instanceof Error) {
		return error.message || error.name;
	}

	// 2. Anything else is written as text with `String()`, so a thrown `undefined` reads as `'undefined'` — the
	//    word says more in a log line than an empty message would
	try {
		return String(error);
	} catch {
		// 3. `String()` calls `toString()`, which an object without a prototype does not have; a description of an
		//    error must never throw itself, so the generic tag stands in
		return Object.prototype.toString.call(error);
	}
};
