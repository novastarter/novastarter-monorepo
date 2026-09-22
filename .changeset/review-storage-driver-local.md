---
'@novastarter/storage-driver-local': minor
---

`read()` now returns a `Readable` that reports a missing file on the stream as `StorageFileNotFoundError` (the `node:fs` error as `cause`) instead of a raw ENOENT error, `write()` goes through a temporary sibling and a final rename so a failed write leaves no partial file under the target name, and `list()` yields nothing instead of rejecting when the prefix directory does not exist; code that typed the result of `read()` as `fs.ReadStream` or checked the stream error for `code === 'ENOENT'` should use `Readable` and `instanceof StorageFileNotFoundError`.
