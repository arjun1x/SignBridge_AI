// Inline copy of resources/icon.svg so the renderer needs no asset fetch.
// With `animated`, the hand waves and the sound waves pulse outward (CSS
// classes defined in styles.css; transform-box: fill-box scopes transforms
// to each SVG group).
export function Logo({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg
      className={`${className ?? ''} ${animated ? 'logo-animated' : ''}`}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b6cf0" />
          <stop offset="1" stopColor="#153a8f" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="104" fill="url(#lg)" />
      <g className="logo-hand" fill="#ffffff">
        <rect x="150" y="128" width="34" height="150" rx="17" />
        <rect x="196" y="96" width="34" height="182" rx="17" />
        <rect x="242" y="112" width="34" height="166" rx="17" />
        <rect x="288" y="140" width="34" height="138" rx="17" />
        <rect x="118" y="238" width="34" height="118" rx="17" transform="rotate(42 135 297)" />
        <path d="M150 250 h172 a0 0 0 0 1 0 0 v66 a86 86 0 0 1 -86 86 a86 86 0 0 1 -86 -86 z" />
      </g>
      <g fill="none" stroke="#7fd0ff" strokeWidth="26" strokeLinecap="round">
        <path className="logo-wave logo-wave-1" d="M366 236 a70 70 0 0 1 0 96" />
        <path className="logo-wave logo-wave-2" d="M404 200 a122 122 0 0 1 0 168" />
      </g>
    </svg>
  )
}
