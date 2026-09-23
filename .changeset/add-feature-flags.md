---
'@novastarter/feature-flags': minor
---

Add `@novastarter/feature-flags`: register the app's flags once with `registerFeatureFlags({ flags })` (or `{ driver }` for a source of your own), then ask `useFeatureFlags().get()` / `getAll()` whether a flag is on for a user and organization, with rules by user, organization and a stable percentage rollout.
