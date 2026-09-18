import { type JSX } from 'react';

/**
 * Link card with a title, an arrow and a short description, opening its target in a new tab.
 *
 * The target URL gets `create-turbo` UTM parameters appended, so visits from the starter template can be told apart
 * in analytics.
 *
 * @param props - Card content and target.
 * @param props.className - Extra class names for the outer link.
 * @param props.title - Heading shown above the description.
 * @param props.children - Description rendered inside the paragraph.
 * @param props.href - Destination URL; UTM parameters are appended to it.
 * @returns The card as an anchor element.
 * @example
 * ```tsx
 * <Card title="Docs" href="https://turborepo.com/docs">Find in-depth information about Turborepo.</Card>
 * ```
 */
export function Card({
  className,
  title,
  children,
  href,
}: {
  className?: string;
  title: string;
  children: React.ReactNode;
  href: string;
}): JSX.Element {
  // 1. `rel` pairs with `target="_blank"` so the opened page cannot reach back into this one via `window.opener`
  return (
    <a
      className={className}
      href={`${href}?utm_source=create-turbo&utm_medium=basic&utm_campaign=create-turbo"`}
      rel="noopener noreferrer"
      target="_blank"
    >
      <h2>
        {title} <span>-&gt;</span>
      </h2>
      <p>{children}</p>
    </a>
  );
}
