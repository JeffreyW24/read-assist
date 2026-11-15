// Small inline icons (no icon library needed). All use currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const IconSun = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconMoon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
);
export const IconBook = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></svg>
);
export const IconMonitor = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
);
export const IconEye = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconPlus = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconArrowLeft = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);
export const IconArrowRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);
export const IconChevronLeft = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconChevronRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 18l6-6-6-6" /></svg>
);
export const IconUpload = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
);
export const IconSparkle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></svg>
);
export const IconClock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconUsers = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>
);
export const IconSettings = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const IconX = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M18 6L6 18M6 6l12 12" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconCamera = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 10l5-3v10l-5-3z" /><rect x="3" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconLogout = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>
);
export const IconBug = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="7" y="7" width="10" height="13" rx="5" /><path d="M12 7V4M9 4.5L10 7M15 4.5L14 7M3 12h4M17 12h4M4 18l3-1.5M20 18l-3-1.5M4 6l3 2M20 6l-3 2" /></svg>
);

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-fg">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="7" fill="var(--accent)" />
        <path d="M6 9h12M6 12.5h9M6 16h11" stroke="var(--accent-fg)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="17.5" cy="12.5" r="1.6" fill="var(--accent-fg)" />
      </svg>
      eyeRead
    </span>
  );
}
