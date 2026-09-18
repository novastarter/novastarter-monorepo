'use client';

import { ReactNode } from 'react';

/**
 * Props of {@link Button}.
 */
interface ButtonProps {
  /** Button label or content. */
  children: ReactNode;
  /**
   * Extra class names for the element.
   *
   * `undefined` is accepted explicitly, like on DOM elements, so callers can pass a CSS-module lookup that may be
   * missing under `noUncheckedIndexedAccess`.
   */
  className?: string | undefined;
  /** App name shown in the greeting the button raises when clicked. */
  appName: string;
}

/**
 * Demo button that greets the user with the app name on click.
 *
 * Marked `"use client"` because the click handler needs the browser; the component cannot render as a React Server
 * Component.
 *
 * @param props - See {@link ButtonProps}.
 * @returns The `<button>` element.
 * @example
 * ```tsx
 * <Button appName="web">Open alert</Button>
 * ```
 */
export const Button = ({ children, className, appName }: ButtonProps) => {
  return (
    <button className={className} onClick={() => alert(`Hello from your ${appName} app!`)}>
      {children}
    </button>
  );
};
