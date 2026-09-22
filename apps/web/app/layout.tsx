import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * The Geist Sans face, self-hosted from the app so no request leaves for a font CDN.
 *
 * Loaded through a CSS variable because that is the handle `globals.css` and the body class below key on.
 *
 * @defaultValue GeistVF.woff under the `--font-geist-sans` variable.
 */
const geistSans = localFont({
	src: './fonts/GeistVF.woff',
	variable: '--font-geist-sans',
});

/**
 * The Geist Mono face, self-hosted from the app so no request leaves for a font CDN.
 *
 * Loaded through a CSS variable for the same reason as the sans face.
 *
 * @defaultValue GeistMonoVF.woff under the `--font-geist-mono` variable.
 */
const geistMono = localFont({
	src: './fonts/GeistMonoVF.woff',
	variable: '--font-geist-mono',
});

/**
 * The document metadata Next.js injects into the head of every page of the app.
 *
 * @defaultValue title "Novastarter Web", description "The web application of the Novastarter monorepo."
 */
export const metadata: Metadata = {
	title: 'Novastarter Web',
	description: 'The web application of the Novastarter monorepo.',
};

/**
 * The root layout every page renders inside: the html/body pair carrying the font variables the stylesheet keys on.
 *
 * @param props - The children are the page being rendered.
 * @returns The html document shell around the page.
 */
export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	// 1. Both font variables land on the body, so every font rule in globals.css applies without a per-page setup
	return (
		<html lang="en">
			<body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
		</html>
	);
}
