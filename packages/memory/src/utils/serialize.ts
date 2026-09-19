import { parseJSON } from '@novastarter/utils';
import { stringToUint8Array } from './string-to-uint8array.js';
import { uint8ArrayToString } from './uint8array-to-string.js';

/**
 * Serialize a JavaScript value to bytes.
 *
 * Values go through JSON, so anything `JSON.stringify` cannot represent (functions, `undefined` inside arrays,
 * class instances) is reduced to its JSON form.
 *
 * @param val - Primitive, plain object or array to serialize.
 * @returns UTF-8 bytes of the JSON text.
 */
export const serialize = (val: unknown): Uint8Array => {
	// 1. JSON keeps the stored form portable between local memory, Redis and other processes
	const valueString = JSON.stringify(val);

	return stringToUint8Array(valueString);
};

/**
 * Deserialize bytes produced by {@link serialize} back into a JavaScript value.
 *
 * @typeParam T - Type the caller expects the value to be.
 * @param val - Bytes to deserialize.
 * @returns The parsed value, or `undefined` for an empty input.
 * @throws `SyntaxError` when the bytes are not valid JSON.
 */
export const deserialize = <T = unknown>(val: Uint8Array): T => {
	// 1. Treat an empty payload as "no value": Redis can hand back an empty reply during disconnects or shutdowns,
	//    and throwing on it would turn a race into a crash
	if (val.length === 0) {
		return undefined as T;
	}

	// 2. Parse with the prototype-safe parser, since the bytes may come from a shared Redis instance
	const valueString = uint8ArrayToString(val);

	return <T>parseJSON(valueString);
};
