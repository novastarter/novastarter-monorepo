import { type JSX } from 'react';

/**
 * Inline code element with an optional class name.
 *
 * @param props - Content and styling.
 * @param props.children - Text or nodes rendered inside the `<code>` element.
 * @param props.className - Extra class names for the element.
 * @returns The `<code>` element.
 * @example
 * ```tsx
 * <Code className="mono">pnpm dev</Code>
 * ```
 */
export function Code({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <code className={className}>{children}</code>;
}
