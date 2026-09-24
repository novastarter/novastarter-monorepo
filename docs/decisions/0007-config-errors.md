# 0007. Configuration errors are `InvalidConfigError`

## Context

Drivers, managers and location configs threw a plain `Error` for a bad configuration (about 280 `throw new Error` in the
repo). A caller could not tell a configuration mistake from any other failure without matching the message text, and the
messages did not always say which driver or option was wrong.

## Decision

- A mistake in driver, manager or location configuration throws `InvalidConfigError` from `@novastarter/errors` (code
  `INVALID_CONFIG`). The message names the subject and what to do: `The mysql database driver needs a "connection"`.
- An error the caller may branch on (bad input, a provider answer, a limit) is a class of the kit with a code.
- A plain `Error` stays only for a broken invariant or a programming mistake that nobody catches; its message still
  names the package and the cause.

## Consequences

- Callers and tests branch on the code, not on the message text.
- A package that throws a configuration error depends on `@novastarter/errors`.
- Changing the error class of an exported function is a minor bump for that package.
