// @ts-check

import eslintJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintImportPlugin from 'eslint-plugin-import-x';
import eslintJsdocPlugin from 'eslint-plugin-jsdoc';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

/**
 * Every source extension ESLint lints in the repository, JavaScript and TypeScript alike.
 */
const SOURCE_FILES = '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}';

/**
 * Files that must keep a default export or dynamic import because a framework demands it.
 *
 * Tools such as Next, Vitest, Drizzle and tsdown read `export default` from their `*.config.*` files, and Next reads
 * it from the route files under `apps/<app>/app/`.
 */
const FRAMEWORK_FILES = ['**/*.config.*', 'apps/*/app/**'];

/**
 * Test files, where a dynamic `import()` is how a module is loaded fresh after `vi.resetModules()` or a mock.
 */
const TEST_FILES = ['**/*.test.{ts,tsx,mts,cts}'];

/**
 * `no-restricted-syntax` entries that keep every exported symbol findable by grep under the one name it is declared
 * with: no barrels, no default exports. Export renaming is caught by the local `no-export-rename` rule instead,
 * because an esquery selector cannot compare two attributes of one node.
 */
const NAMED_EXPORT_SYNTAX = [
	{
		selector: 'ExportAllDeclaration',
		message: 'List the re-exported names explicitly instead of `export *`, so each symbol can be found by grep.',
	},
	{
		selector: 'ExportDefaultDeclaration',
		message: 'Use a named export instead of `export default`, so the symbol has one name everywhere.',
	},
];

/**
 * `no-restricted-syntax` entry that bans a dynamic `import()`, whose target a reader cannot follow statically.
 */
const DYNAMIC_IMPORT_SYNTAX = {
	selector: 'ImportExpression',
	message:
		'Use a static import. A dynamic `import()` needs an `eslint-disable-next-line` comment with the reason it cannot be static.',
};

/**
 * Local rule that forbids renaming a symbol on export (`export { a as b }`), which gives one symbol two names.
 *
 * The rule compares the local and exported name of every export specifier; `export { default as X } from` counts as a
 * rename too, since it re-labels a default export.
 */
const noExportRename = {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow renaming a symbol on export' },
		schema: [],
		messages: {
			rename: 'Export `{{local}}` under its own name instead of renaming it to `{{exported}}`.',
		},
	},
	/**
	 * Build the visitor that reports every renamed export specifier.
	 *
	 * @param {import('eslint').Rule.RuleContext} context - Rule context used to report problems.
	 * @returns {import('eslint').Rule.RuleListener} The AST visitor.
	 */
	create(context) {
		return {
			/**
			 * Report the specifier when its local name differs from the name it is exported under.
			 *
			 * @param {import('estree').ExportSpecifier} node - The export specifier being visited.
			 */
			ExportSpecifier(node) {
				// Either side may be a string literal (`export { a as 'b' }`), so read `name` or `value`
				const local = node.local.type === 'Identifier' ? node.local.name : String(node.local.value);
				const exported = node.exported.type === 'Identifier' ? node.exported.name : String(node.exported.value);

				// `export { a as a }` names the symbol once, so only a differing pair is a rename
				if (local !== exported) {
					context.report({ node, messageId: 'rename', data: { local, exported } });
				}
			},
		};
	},
};

/**
 * Local rule that forbids numbered line comments (`// 1. Parse the input`) inside code.
 *
 * Numbered step comments retell the code and go stale; the step order is already visible from the code itself. See
 * `docs/decisions/0006-comments-explain-why.md`.
 */
const noNumberedComments = {
	meta: {
		type: 'suggestion',
		docs: { description: 'Disallow numbered step comments' },
		schema: [],
		messages: {
			numbered:
				'Drop the step number: keep the comment only if it explains why, a constraint or a non-obvious consequence.',
		},
	},
	/**
	 * Build the visitor that reports every line comment starting with `<digits>.`.
	 *
	 * @param {import('eslint').Rule.RuleContext} context - Rule context used to report problems.
	 * @returns {import('eslint').Rule.RuleListener} The AST visitor.
	 */
	create(context) {
		return {
			/**
			 * Scan all comments once per file; comments are not AST nodes, so no node visitor would reach them.
			 */
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (comment.type === 'Line' && /^\s*\d+\.\s/.test(comment.value)) {
						context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: 'numbered' });
					}
				}
			},
		};
	},
};

/**
 * Plugin holding the repository's own rules, registered once under the `local` prefix.
 *
 * Flat config refuses to redefine a plugin name with a different object, so every config block reuses this one.
 */
const localPlugin = {
	rules: { 'no-export-rename': noExportRename, 'no-numbered-comments': noNumberedComments },
};

/**
 * Single ESLint flat config shared by every package and app in the monorepo.
 *
 * Packages and apps carry no `eslint.config.*` of their own: ESLint 10 looks the config up from each linted file
 * towards the filesystem root, so this file applies to all of them and `pnpm lint` runs once from the repository
 * root. Formatting rules are left to Prettier, which is why `eslintConfigPrettier` comes last and wins.
 */
export default typescriptEslint.config(
	// Global config
	{
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},

	// Ignored files: flat config only skips node_modules and .git by itself, so build output must be listed here
	{
		ignores: ['**/dist/', '**/.next/', '**/coverage/', '**/next-env.d.ts'],
	},

	// Enable recommended rules for JS files
	eslintJs.configs.recommended,

	// Custom basic rules
	{
		rules: {
			// No console & debugger statements, everywhere: lint severity must not depend on the ambient
			// environment, or the same source lints clean on a developer machine and fails in CI
			'no-console': 'error',
			'no-debugger': 'error',
			// Require empty line between certain statements
			'padding-line-between-statements': [
				'error',
				{
					blankLine: 'always',
					prev: [
						'block',
						'block-like',
						'cjs-export',
						'class',
						'export',
						'import',
						'multiline-block-like',
						'multiline-const',
						'multiline-expression',
						'multiline-let',
						'multiline-var',
					],
					next: '*',
				},
				{
					blankLine: 'always',
					prev: ['const', 'let'],
					next: ['block', 'block-like', 'cjs-export', 'class', 'export', 'import'],
				},
				{
					blankLine: 'always',
					prev: '*',
					next: ['multiline-block-like', 'multiline-const', 'multiline-expression', 'multiline-let', 'multiline-var'],
				},
				{ blankLine: 'any', prev: ['export', 'import'], next: ['export', 'import'] },
			],
			// Require empty line between class members
			'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
			// Disallow nested ternary expressions
			'no-nested-ternary': 'error',
			// Disallow expressions where the operation doesn't affect the value
			'no-constant-binary-expression': 'error',
			// Added to eslint:recommended in ESLint 10. Downgraded to warnings so the toolchain
			// upgrade lands on its own; the existing hits need case-by-case review (some are dead
			// initializers, others are load-bearing guard flags) in a dedicated pass.
			'no-useless-assignment': 'warn',
			'preserve-caught-error': 'warn',
			// Sort members
			'sort-imports': [
				'error',
				{
					ignoreCase: true,
					ignoreDeclarationSort: true,
					allowSeparatedGroups: true,
				},
			],
		},
	},

	// Enable import plugin and custom rules for import sorting
	{
		plugins: { import: eslintImportPlugin },
		rules: {
			'import/order': [
				'error',
				{
					'newlines-between': 'never',
					alphabetize: {
						order: 'asc',
						orderImportKind: 'asc',
						caseInsensitive: true,
					},
				},
			],
		},
	},

	// Enable TypeScript plugin and recommended rules for TypeScript files
	...typescriptEslint.configs.recommended,

	// Custom TypeScript rules; `.tsx` is included so React components get the same relaxations as plain modules
	{
		files: ['**/*.{ts,mts,cts,tsx}'],
		rules: {
			// Allow unused arguments and variables when they begin with an underscore
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			// A suppressed compiler error must say why; `@ts-ignore` and `@ts-nocheck` hide errors silently
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-check': false,
					'ts-expect-error': 'allow-with-description',
					'ts-ignore': true,
					'ts-nocheck': true,
				},
			],
			// `any` switches the type checker off, so it is banned in tests too: mocks get real types
			'@typescript-eslint/no-explicit-any': 'error',
		},
	},

	// AGENTS.md "comment all code": JSDoc above every module-level function and function-valued `const`, every class
	// and method, and every exported type or `const`, in every file of the repository. Helpers declared inside a
	// function body and callbacks passed as arguments (`it(() => …)`, `.map(…)`) are part of the enclosing function
	// and need none. Numbered step comments are banned everywhere
	{
		files: [SOURCE_FILES],
		plugins: { jsdoc: eslintJsdocPlugin, local: localPlugin },
		rules: {
			'local/no-numbered-comments': 'error',
			'jsdoc/require-jsdoc': [
				'error',
				{
					// The fixer would insert empty `/** */` stubs on `--fix`, which satisfy the rule and document nothing
					enableFixer: false,
					publicOnly: false,
					exemptEmptyConstructors: false,
					exemptEmptyFunctions: false,
					require: {
						ArrowFunctionExpression: false,
						ClassDeclaration: true,
						ClassExpression: false,
						FunctionDeclaration: false,
						FunctionExpression: false,
						MethodDefinition: true,
					},
					contexts: [
						// A function stored in a module-level `const`; an exported one is covered by the
						// `ExportNamedDeclaration` context below. A helper `const` inside a function body is a step of
						// that function and needs no JSDoc of its own
						'Program > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
						'Program > VariableDeclaration > VariableDeclarator > FunctionExpression',
						// A declared function at module level, exported or not; a function declared inside another one
						// is a step of it, like a helper `const`
						'Program > FunctionDeclaration',
						'ExportNamedDeclaration > FunctionDeclaration',
						'ExportDefaultDeclaration > FunctionDeclaration',
						// A class field holding a function is a method written as an arrow
						'PropertyDefinition > ArrowFunctionExpression',
						'TSAbstractMethodDefinition',
						// Exported declarations are matched on the `export` node, where their JSDoc sits
						'ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
						'ExportNamedDeclaration[declaration.type="TSTypeAliasDeclaration"]',
						'ExportNamedDeclaration[declaration.type="TSInterfaceDeclaration"]',
					],
				},
			],
			// Every argument gets a `@param`; destructured properties are left to the prose, a root `@param` suffices
			'jsdoc/require-param': ['error', { checkDestructured: false }],
			'jsdoc/check-param-names': ['error', { checkDestructured: false }],
		},
	},

	// AGENTS.md "grep-friendly code": named exports only and static imports only, in packages and apps. Framework
	// files are exempt because Next and the tool configs read their default export
	{
		files: [`packages/${SOURCE_FILES}`, `apps/${SOURCE_FILES}`],
		ignores: [...FRAMEWORK_FILES, ...TEST_FILES],
		plugins: { local: localPlugin },
		rules: {
			'no-restricted-syntax': ['error', ...NAMED_EXPORT_SYNTAX, DYNAMIC_IMPORT_SYNTAX],
			'local/no-export-rename': 'error',
		},
	},

	// Tests follow the same export rules but may load a module with `import()`, e.g. after `vi.resetModules()`
	{
		files: TEST_FILES.flatMap((pattern) => [`packages/${pattern}`, `apps/${pattern}`]),
		ignores: FRAMEWORK_FILES,
		plugins: { local: localPlugin },
		rules: {
			'no-restricted-syntax': ['error', ...NAMED_EXPORT_SYNTAX],
			'local/no-export-rename': 'error',
		},
	},

	// Packages take configuration as arguments; `@novastarter/env` is the one reader of the environment. The release
	// notes CLI reads its own env by design, and integration tests read connection strings of real services
	{
		files: [`packages/${SOURCE_FILES}`],
		ignores: ['packages/env/**', 'packages/release-notes-generator/**', '**/*.int.test.ts'],
		rules: {
			'no-restricted-properties': [
				'error',
				{
					object: 'process',
					property: 'env',
					message: 'Packages take configuration as arguments; read the environment through `@novastarter/env`.',
				},
			],
		},
	},

	// Packages are shared by every app, so they never depend on one: no paths into `apps/`, no app package names
	{
		files: [`packages/${SOURCE_FILES}`],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '(^|/)apps/',
							message: 'Packages must not import from `apps/`; move the shared code into a package.',
						},
						{
							regex: '^(@novastarter/)?(web|docs)(/|$)',
							message: 'Packages must not import an app; move the shared code into a package.',
						},
					],
				},
			],
		},
	},

	eslintConfigPrettier,
);
