/**
 * FlowApprove's mark: a request starts as a dot, flows along a line and ends in a check.
 * The same drawing is the browser tab icon (public/favicon.svg).
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="FlowApprove">
      <defs>
        <linearGradient id="flowapprove-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#flowapprove-mark)" />
      <circle cx="7" cy="19" r="2.4" fill="#fff" />
      <path
        d="M9.4 19H12.5L16.5 23L25 10.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
