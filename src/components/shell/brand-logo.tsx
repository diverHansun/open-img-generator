import { useId } from 'react';

/**
 * The "Develop" logo: a frame whose diagonal lines thicken toward the lower-right
 * corner until they fuse solid, like an image developing. Single ink via currentColor.
 * Master geometry lives in docs/brand/logo-*.svg; keep the two in sync.
 */
export function BrandLogo({ size = 20, className }: { size?: number; className?: string }) {
  const clipId = useId();
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="14" y="14" width="72" height="72" stroke="currentColor" strokeWidth="8" />
      <clipPath id={clipId}>
        <rect x="24" y="24" width="52" height="52" />
      </clipPath>
      <g clipPath={`url(#${clipId})`} stroke="currentColor">
        <path d="M-36 100L64 0" strokeWidth="2" />
        <path d="M-20 100L80 0" strokeWidth="4" />
        <path d="M-2 100L98 0" strokeWidth="7" />
        <path d="M18 100L118 0" strokeWidth="11" />
        <path d="M131 0H200V100H31Z" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
