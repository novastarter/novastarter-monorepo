# `@novastarter/tsconfig`

Shared TSConfig files used by packages and apps in this monorepo.

The following configs are available:

- [`node22`](./configs/node22/tsconfig.json) - Config for Node.js modules, aligned with the Node.js 24 floor the
  monorepo declares in `engines.node` (the export name is kept for compatibility)
- [`react-library`](./configs/react-library/tsconfig.json) - Config for React component libraries consumed by a bundler
- [`nextjs`](./configs/nextjs/tsconfig.json) - Config for Next.js apps
- [`base`](./configs/base/tsconfig.json) - Set of basic rules (included in all of the configs above)

## Usage

Add the package as a workspace dependency:

```json
{
	"devDependencies": {
		"@novastarter/tsconfig": "workspace:*"
	}
}
```

To use one of the shared configs, extend the local `tsconfig.json` from it:

```json
{
	"extends": "@novastarter/tsconfig/node22"
}
```
