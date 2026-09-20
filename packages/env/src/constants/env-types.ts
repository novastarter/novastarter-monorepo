/**
 * Casting flags that are read from env var values.
 *
 * A value prefixed with one of these followed by a colon is coerced to that type — the only conversion the package
 * does — so `number:1` is read as `1` while a bare `1` stays `'1'` for the application's schema to type.
 *
 * @defaultValue `['string', 'number', 'regex', 'array', 'json', 'boolean']`
 */
export const ENV_TYPES = ['string', 'number', 'regex', 'array', 'json', 'boolean'] as const;
