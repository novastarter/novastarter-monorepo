# `@novastarter/feature-flags`

Feature flags for Novastarter: a driver contract, rules by user, organization and percentage, and a static driver.

## Installation

```
pnpm add @novastarter/feature-flags
```

## Usage

At start-up, once — the flags as the app builds them from its own configuration; `env` is the app's typed configuration.
The `static` driver is registered already.

```ts
import { useFeatureFlags } from '@novastarter/feature-flags';
import { env } from './env';

useFeatureFlags().registerLocation('default', {
	driver: 'static',
	options: {
		flags: [
			{ key: 'new-billing', enabled: env.FEATURE_NEW_BILLING, rules: { percentage: 10 } },
			{ key: 'beta-ai', enabled: true, rules: { organizations: ['org_1'] } },
		],
	},
});
```

Anywhere later:

```ts
const flags = useFeatureFlags().location('default');

await flags.get('new-billing', { user: 'u1', organization: 'o1' }); // true | false
await flags.getAll({ user: 'u1' }); // { 'new-billing': true, 'beta-ai': false }
await flags.list(); // the definitions
```

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

| Driver   | Where the flags live                                             |
| -------- | ---------------------------------------------------------------- |
| `static` | The `flags` option: fixed for the process, a change is a restart |

Another source — a table, a vendor — is a class implementing `FeatureFlagsDriver` (`get`, `getAll`, `list`, optionally
`close`), added to the map of options and registered:

```ts
declare module '@novastarter/feature-flags' {
	interface FeatureFlagsDrivers {
		vendor: VendorConfig;
	}
}

useFeatureFlags().registerDriver('vendor', FeatureFlagsDriverVendor);
```
