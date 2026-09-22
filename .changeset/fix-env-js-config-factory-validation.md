---
'@novastarter/env': patch
---

A JavaScript config file whose export is a function now has the factory's return value validated: a factory returning a non-object (for example `undefined`) throws `Invalid JS configuration file export type` instead of silently merging nothing into the configuration.
