---
'web': patch
'docs': patch
---

Remove the `@novastarter/ui` starter package with its `Button`, `Card` and `Code` components; the `web` and `docs` apps no longer depend on it and render a plain `<button>` in its place.
