---
'@novastarter/storage': patch
---

`list()` with a prefix that resolves to a folder (`.`, `..`, `avatars/..`, `avatars/.`) now lists that folder instead of every key sharing the root as a string prefix, so `media-archive/…` no longer leaks into a `media` location.
