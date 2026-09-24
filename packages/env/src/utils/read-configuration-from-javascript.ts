import { createRequire } from 'node:module';
import { InvalidConfigError } from '@novastarter/errors';
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
 * @throws InvalidConfigError when the export is neither a function nor a plain object, or a function export does not
 * return a plain object.
 */
export const readConfigurationFromJavaScript = (path: string): Record<string, unknown> => {
	// A `require` bound to this module, since ESM has no global one
	const require = createRequire(import.meta.url);

	const module = require(path);

	// Declared outside the block so the error below can name the type of whatever was found (or `undefined`);
	// `unknown` because `require` returns `any` and the checks below are the runtime validation
	let exported: unknown;

	// ESM-style `default` export and CJS `module.exports` are both accepted; `typeof null` is `object` too, so a
	// null export must be excluded before the `in` operator below touches it — otherwise it would crash with a raw
	// TypeError instead of the documented error
	if ((typeof module === 'object' && module !== null) || typeof module === 'function') {
		exported = 'default' in module ? module.default : module;

		// A factory gets the raw environment so it can compute values from it; its result must be a plain object,
		// like the export of a data module, so a factory returning nothing is rejected below instead of flowing
		// into the merge as `undefined`
		if (typeof exported === 'function') {
			exported = exported(process.env);
		}

		// Class instances and arrays are rejected on purpose; configuration is a plain key/value map
		if (isPlainObject(exported)) {
			return exported as Record<string, unknown>;
		}
	}

	// Reached when the export was neither a plain object nor a factory returning one: the refusal names the
	// type that was actually found (or `undefined`), so the author sees what the file handed over
	throw new InvalidConfigError({
		reason: `The JavaScript configuration file must export an object or a function returning one, not "${typeof exported}"`,
	});
};
