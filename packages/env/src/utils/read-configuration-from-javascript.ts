import { createRequire } from 'node:module';
import { isPlainObject } from 'lodash-es';

/**
 * Load configuration from a JavaScript module.
 *
 * The module may export a plain object, or a function that receives `process.env` and returns the object, which lets
 * a config file derive values from the environment. Loading is synchronous via `require`, because configuration is
 * needed before anything async can run; this means the file has to be CommonJS-loadable.
 *
 * @param path - Path to the `.js`, `.cjs` or `.mjs` file.
 * @returns The configuration object.
 * @throws When the export is neither a function nor a plain object.
 */
export const readConfigurationFromJavaScript = (path: string): Record<string, unknown> => {
	// 1. A `require` bound to this module, since ESM has no global one
	const require = createRequire(import.meta.url);

	const module = require(path);

	// 2. Declared outside the block so the error below can name the type of whatever was found (or `undefined`);
	//    `any` because `require` returns `any` and the checks below are the runtime validation
	let exported: any;

	// 3. ESM-style `default` export and CJS `module.exports` are both accepted
	if (typeof module === 'object' || typeof module === 'function') {
		exported = 'default' in module ? module.default : module;

		// 4. A factory gets the raw environment so it can compute values from it
		if (typeof exported === 'function') {
			return exported(process.env) as Record<string, unknown>;
		}

		// 5. Class instances and arrays are rejected on purpose; configuration is a plain key/value map
		if (isPlainObject(exported)) {
			return exported as Record<string, unknown>;
		}
	}

	throw new Error(
		`Invalid JS configuration file export type. Requires one of "function", "object", received: "${typeof exported}"`,
	);
};
