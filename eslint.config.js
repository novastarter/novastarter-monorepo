// @ts-check

import process from 'node:process';
import eslintJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintImportPlugin from 'eslint-plugin-import-x';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

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
			// No console & debugger statements in production
			'no-console': process.env.NODE_ENV !== 'development' ? 'error' : 'off',
			'no-debugger': process.env.NODE_ENV !== 'development' ? 'error' : 'off',
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
		files: ['**/*.{ts,tsx}'],
		rules: {
			// Allow unused arguments and variables when they begin with an underscore
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			// Allow ts-directive comments (used to suppress TypeScript compiler errors)
			'@typescript-eslint/ban-ts-comment': 'off',
			// Allow usage of the any type (consider enabling this rule later on)
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},

	eslintConfigPrettier,
);
