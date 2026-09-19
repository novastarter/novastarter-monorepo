/**
 * Casting flags that are read from env var values.
 *
 * A value prefixed with one of these followed by a colon is coerced to that type instead of being guessed, so
 * `number:1` is read as `1` instead of `'1'` and `string:1` stays `'1'`.
 *
 * @defaultValue `['string', 'number', 'regex', 'array', 'json', 'boolean']`
 */
export const ENV_TYPES = ['string', 'number', 'regex', 'array', 'json', 'boolean'] as const;
