/**
 * Public entry point of `@novastarter/validation`.
 *
 * `validatePayload` checks an object against `_and` / `_or` / field filter rules and returns one
 * `FailedValidationError` per failed rule, with the field, the rule and the compared value in `extensions`.
 * `generateJoi` exposes the schema builder behind it, `Joi` the extended instance the schemas are made with, and
 * `joiValidationErrorItemToErrorExtensions` the converter for callers that run Joi themselves.
 */
export * from './errors/index.js';
export * from './lib/index.js';
export * from './utils/index.js';
