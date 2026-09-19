import type { NewChangesetWithCommit, VersionType } from '@changesets/types';

/**
 * Changesets collected while `changesets` versions the packages, keyed by changeset id.
 *
 * The id is dropped from the value because it is the map key; `notice` holds the text of an optional `::: notice`
 * block that was cut out of the summary.
 */
export type Changesets = Map<string, Omit<NewChangesetWithCommit, 'id'> & { notice: string | undefined }>;

/**
 * A single change described by a changeset.
 */
export interface Change {
	/** Changeset summary with the notice block removed. */
	summary: string;
	/** Commit that added the changeset, when `changesets` could resolve it. */
	commit: string | undefined;
}

/**
 * A notice cut out of a changeset summary, kept together with the change it belongs to.
 */
export interface Notice {
	/** Markdown body of the `::: notice` block. */
	notice: string;
	/** The change the notice was attached to. */
	change: Change;
}

/**
 * Changes grouped under one workspace package inside a version type section.
 */
export interface Package {
	/** Package name as declared in its `package.json`. */
	name: string;
	/** Changes released for this package. */
	changes: Change[];
}

/**
 * Changes grouped under an untyped package, i.e. one whose changes are listed under a custom title instead of a
 * version type section.
 */
export interface UntypedPackage {
	/** Title from {@link Config.untypedPackageTitles}, which replaces the package name in the output. */
	name: string;
	/** Changes released for this package. */
	changes: Change[];
}

/**
 * A release notes section for one version type (major, minor, patch or none).
 */
export interface Type {
	/** Section title from {@link Config.typedTitles}. */
	title: string;
	/** Packages with changes of this version type. */
	packages: Package[];
}

/**
 * A published package together with the version it was bumped to.
 */
export interface PackageVersion {
	/** Package name as declared in its `package.json`. */
	name: string;
	/** Version written by `changesets`. */
	version: string;
}

/**
 * Settings that shape the generated release notes.
 */
export interface Config {
	/** GitHub repository. */
	repo: string;
	/**
	 * Main package.
	 *
	 * Its version becomes the headline version of the release. When omitted, the headline version is only known when
	 * forced through the `NOVASTARTER_VERSION` environment variable.
	 */
	mainPackage?: string;
	/** Titles for version types. */
	typedTitles: Record<VersionType, string>;
	/** Titles for untyped packages. */
	untypedPackageTitles: Record<string, string>;
	/** Title for list of published versions. */
	versionTitle: string;
	/** Under which version type notices should appear. */
	noticeType: VersionType;
	/** How packages should be sorted in the release notes. */
	packageOrder: string[];
	/**
	 * List of linked packages, where in case the first one is bumped,
	 * the second will be patch bumped if not already bumped anyway.
	 *
	 * Note: This is different from the option of `changesets`.
	 */
	linkedPackages: [string, string][];
}
