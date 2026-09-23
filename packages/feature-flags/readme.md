# `@novastarter/feature-flags`

Feature flags for Novastarter: a driver contract, rules by user, organization and percentage, and a static driver.

## Installation

```
pnpm add @novastarter/feature-flags
```

## Usage

At start-up, once — the flags as the app builds them from its own configuration; `env` is the app's typed configuration.

```ts
import { registerFeatureFlags } from '@novastarter/feature-flags';
import { env } from './env';

registerFeatureFlags({
	flags: [
		{ key: 'beta-ai', enabled: true, rules: { organizations: ['org_1'] } },
		{ key: 'new-billing', enabled: env.FEATURE_NEW_BILLING, rules: { percentage: 10 } },
	],
});
```

Anywhere later:

```ts
import { useFeatureFlags } from '@novastarter/feature-flags';

await useFeatureFlags().get('new-billing', { user: 'u1', organization: 'o1' }); // true | false
await useFeatureFlags().getAll({ user: 'u1' }); // { 'beta-ai': false, 'new-billing': false } — u1 is outside the 10 %
await useFeatureFlags().list(); // the definitions
```

`useFeatureFlags()` throws until `registerFeatureFlags()` ran, so a forgotten registration does not look like every
feature switched off. Registering again replaces the flags; at shutdown, `useFeatureFlags().close()` releases the
driver.

A flag nobody defined is off.

## Rules

A flag is on for a caller when its switch is on and its rules let the caller through:

- `users`: the user is listed;
- `organizations`: the organization is listed;
- `percentage`: the subject — the user, else the organization — falls within the share. The bucket is a hash of the
  flag's key and the subject's id, so a subject stays on the same side everywhere, raising the share only adds subjects,
  and two rollouts do not pick the same subjects.

Any rule that matches is enough; a flag with no rules is on for everyone; a disabled flag is off for everyone.
`evaluateFeatureFlag(definition, context)` is the pure function behind it, `featureFlagDefinitionSchema` what a
definition is validated against.

## Drivers

Plain `flags` are served by `FeatureFlagsDriverStatic`: fixed for the life of the process, a change is a restart.

Another source — a table, a vendor — is a class implementing `FeatureFlagsDriver` (`get`, `getAll`, `list`, optionally
`close`), registered as a ready instance:

```ts
registerFeatureFlags({ driver: new FeatureFlagsDriverVendor({ apiKey: env.FLAGS_API_KEY }) });
```
