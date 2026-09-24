/**
 * Public entry point of `@novastarter/validation`.
 *
 * `validatePayload` checks an object against `_and` / `_or` / field filter rules and returns one
 * `FailedValidationError` per failed rule, with the field, the rule and the compared value in `extensions`.
 * `generateJoi` exposes the schema builder behind it, `Joi` the extended instance the schemas are made with, and
 * `joiValidationErrorItemToErrorExtensions` / `zodErrorToErrorExtensions` the converters for callers that run Joi or
 * zod themselves, so every rejected payload is reported in the same shape.
 */
export { FailedValidationError, type FailedValidationErrorExtensions, messageConstructor } from './errors/index.js';
export { generateJoi, Joi, type JoiOptions, type StringSchema, validatePayload } from './lib/index.js';
export { joiValidationErrorItemToErrorExtensions, zodErrorToErrorExtensions } from './utils/index.js';
