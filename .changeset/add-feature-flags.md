---
'@novastarter/feature-flags': minor
---

Add `@novastarter/feature-flags`, feature flags through the `FeatureFlagsManager` of `useFeatureFlags()`: register a location with the built-in `static` driver and its flags at start-up, then ask `get()` / `getAll()` whether a flag is on for a user and organization, with rules by user, organization and a stable percentage rollout.
