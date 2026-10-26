import type { HTMLAttributes, ReactNode } from 'react';

type Props<T extends HTMLElement> = HTMLAttributes<T> & { children?: ReactNode };

const join = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);

/** The page's single `<h1>` (token `title-page`). */
export function PageTitle({ className, ...rest }: Props<HTMLHeadingElement>) {
  return <h1 {...rest} className={join('type-title-page', className)} />;
}

/** Section `<h2>` (token `title-section`). */
export function SectionTitle({ className, ...rest }: Props<HTMLHeadingElement>) {
  return <h2 {...rest} className={join('type-title-section', className)} />;
}

/** Small uppercase overline (token `eyebrow`). The only uppercase text style. */
export function Eyebrow({ className, ...rest }: Props<HTMLSpanElement>) {
  return <span {...rest} className={join('type-eyebrow', className)} />;
}

/** Number that must line up: tabular figures. */
export function Num({ className, ...rest }: Props<HTMLSpanElement>) {
  return <span {...rest} className={join('tnum', className)} />;
}

/** Inline machine text: identifiers, paths, SQL fragments (token `code-inline`). */
export function Code({ className, ...rest }: Props<HTMLElement>) {
  return <code {...rest} className={join('type-code-inline', className)} />;
}
