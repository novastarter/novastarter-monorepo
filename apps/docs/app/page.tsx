import Image, { type ImageProps } from 'next/image';
import styles from './page.module.css';

/**
 * Props of {@link ThemeImage}: the two theme variants of one image stand in for the single `src` a plain
 * `next/image` takes.
 */
type Props = Omit<ImageProps, 'src'> & {
	srcLight: string;
	srcDark: string;
};

/**
 * One logo that follows the theme: `next/image` cannot switch sources by itself, so the light and dark variants
 * render as two elements and the CSS shows exactly one of them.
 *
 * @param props - The image props, with `srcLight` and `srcDark` in place of `src`.
 * @returns Both variants; the stylesheet hides the one that does not match the active theme.
 */
const ThemeImage = (props: Props) => {
	// 1. The theme sources are split off, so every other prop reaches both images unchanged
	const { srcLight, srcDark, ...rest } = props;

	// 2. Both variants render into the page; globals.css keeps only the matching one visible
	return (
		<>
			<Image {...rest} src={srcLight} className="imgLight" />
			<Image {...rest} src={srcDark} className="imgDark" />
		</>
	);
};

/**
 * The landing page of the app: the Turborepo starter screen with its calls to action.
 *
 * The page is a Server Component — the leftover demo button carries no click handler, so nothing here needs client
 * JavaScript.
 *
 * @returns The whole page as one static tree.
 */
export default function Home() {
	// 1. The "Deploy now" link points Vercel at this app's directory in the monorepo template, so the clone builds
	//    the docs app rather than its sibling
	return (
		<div className={styles.page}>
			<main className={styles.main}>
				<ThemeImage
					className={styles.logo}
					srcLight="turborepo-dark.svg"
					srcDark="turborepo-light.svg"
					alt="Turborepo logo"
					width={180}
					height={38}
					priority
				/>
				<ol>
					<li>
						Get started by editing <code>apps/docs/app/page.tsx</code>
					</li>
					<li>Save and see your changes instantly.</li>
				</ol>

				<div className={styles.ctas}>
					<a
						className={styles.primary}
						href="https://vercel.com/new/clone?demo-description=Learn+to+implement+a+monorepo+with+a+two+Next.js+sites+that+has+installed+three+local+packages.&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F4K8ZISWAzJ8X1504ca0zmC%2F0b21a1c6246add355e55816278ef54bc%2FBasic.png&demo-title=Monorepo+with+Turborepo&demo-url=https%3A%2F%2Fexamples-basic-web.vercel.sh%2F&from=templates&project-name=Monorepo+with+Turborepo&repository-name=monorepo-turborepo&repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fturborepo%2Ftree%2Fmain%2Fexamples%2Fbasic&root-directory=apps%2Fdocs&skippable-integrations=1&teamSlug=vercel&utm_source=create-turbo"
						target="_blank"
						rel="noopener noreferrer"
					>
						<Image className={styles.logo} src="/vercel.svg" alt="Vercel logomark" width={20} height={20} />
						Deploy now
					</a>
					<a
						href="https://turborepo.dev/docs?utm_source"
						target="_blank"
						rel="noopener noreferrer"
						className={styles.secondary}
					>
						Read our docs
					</a>
				</div>
				{/* Plain button left over from the removed `@novastarter/ui` demo component; no click handler, so the page stays a Server Component */}
				<button type="button" className={styles.secondary}>
					Open alert
				</button>
			</main>
			<footer className={styles.footer}>
				<a
					href="https://vercel.com/templates?search=turborepo&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Image aria-hidden src="/window.svg" alt="Window icon" width={16} height={16} />
					Examples
				</a>
				<a href="https://turborepo.dev?utm_source=create-turbo" target="_blank" rel="noopener noreferrer">
					<Image aria-hidden src="/globe.svg" alt="Globe icon" width={16} height={16} />
					Go to turborepo.dev →
				</a>
			</footer>
		</div>
	);
}
