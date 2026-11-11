/**
 * Settle's mark: a blocky S of three horizontal ledger rules joined by short
 * verticals, with hooks at both ends so it does not read as a 5. Static; no
 * props beyond size/title/className.
 */
export function BrandMark({ size = 24, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={['brand-mark', className].filter(Boolean).join(' ')}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M20 8V5H4v7h16v7H4v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
