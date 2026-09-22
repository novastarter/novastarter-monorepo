---
'web': patch
---

The "Deploy now" button now provisions the web app instead of the docs app, the PlanCatalog tests live in their own `plan-catalog.test.ts`, the previously undocumented modules and configs carry the comments the rulebook demands, `.env.example` documents every variable of `env.ts`, and `pnpm test:coverage` reaches the app through the workspace-wide task.
