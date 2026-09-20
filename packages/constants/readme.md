# `@novastarter/constants`

Shared constants for Novastarter.

## Description

Values several packages agree on, kept in one place so they cannot drift: the text credentials are replaced with in
logs, the file extensions that count as JavaScript, the default chunk size of resumable uploads. Grouped per topic in
their own module and re-exported from the package root.

## Installation

```
pnpm add @novastarter/constants
```

## Usage

```ts
import { DEFAULT_CHUNK_SIZE, JAVASCRIPT_FILE_EXTS, REDACTED_TEXT } from '@novastarter/constants';

REDACTED_TEXT; // '--redacted--', what the logger writes in place of a secret
JAVASCRIPT_FILE_EXTS; // ['js', 'mjs', 'cjs']
DEFAULT_CHUNK_SIZE; // 8 MiB, the resumable-upload chunk size the storage drivers start from
```
