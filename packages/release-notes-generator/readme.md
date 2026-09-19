# `@novastarter/release-notes-generator`

A release notes generator for [`changesets`](https://github.com/changesets/changesets) used in the Nova monorepo.

## Installation

```shell
pnpm add -D @novastarter/release-notes-generator
```

## Usage

Update the `.changeset/config.json` file to point to this package:

```json
	"changelog": "@novastarter/release-notes-generator",
```

The release notes will be generated and printed when running the `changesets` command to update the versions:

```shell
pnpm changeset version
```

Every change links to the commit that added its changeset, as resolved by `changesets` through `git log`. No GitHub
token is needed.

The headline version of a release is optional: it is taken from the main package configured in `src/config.ts`, or
forced through an environment variable. Without either, the release notes are printed without a headline version.

To force the main version:

```shell
NOVASTARTER_VERSION=10.0.0 pnpm changeset version

# To force a prerelease version you need to be in prerelease mode
pnpm changeset pre enter beta
NOVASTARTER_VERSION=10.0.0-beta.0 pnpm changeset version
```

### GitHub CI

When running `pnpm changeset version` in the GitHub CI context, this package will automatically set the following
outputs:

- `NOVASTARTER_VERSION` (available if a headline version is known)
- `NOVASTARTER_PRERELEASE`
- `NOVASTARTER_PRERELEASE_ID` (available if `NOVASTARTER_PRERELEASE` is `true`)
- `NOVASTARTER_RELEASE_NOTES`

## Special Changesets Features

### Notices in Changesets

In addition to the normal content, changeset may include a notice to draw special attention to a change. These notices
will be rendered in the release notes under the section "⚠️ Potential Breaking Changes".

Use the following format to add such a notice:

<!-- prettier-ignore -->
```md
---
'example-package': patch
---

::: notice
Notices can contain any markdown syntax

- An important notice
:::

Normal changeset summary
```
