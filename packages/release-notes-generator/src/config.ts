import type { Config } from './types.js';

/**
 * Release notes settings for the Novastarter monorepo.
 *
 * There is no main package, so the headline version only exists when `NOVASTARTER_VERSION` is set. Neither a package
 * order nor linked packages are needed yet, hence the empty lists.
 *
 * @defaultValue Titles with emoji per version type, `docs` listed under its own "Documentation" section, notices
 * shown under the major section.
 */
const config: Config = {
	repo: 'novastarter/novastarter-monorepo',
	typedTitles: {
		major: '⚠️ Potential Breaking Changes',
		minor: '✨ New Features & Improvements',
		patch: '🐛 Bug Fixes & Optimizations',
		none: '📎 Misc.',
	},
	untypedPackageTitles: {
		docs: '📝 Documentation',
	},
	versionTitle: '📦 Published Versions',
	noticeType: 'major',
	packageOrder: [],
	linkedPackages: [],
};

export default config;
