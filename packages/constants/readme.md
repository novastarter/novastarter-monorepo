# `@novastarter/constants`

Shared constants for Novastarter.

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
