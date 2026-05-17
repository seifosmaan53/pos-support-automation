/**
 * Lightweight inline SVG icon set. Bundled rather than imported from a library
 * to keep the dependency footprint minimal — this app only needs ~15 icons.
 *
 * Usage: <Icon name="record" className="h-4 w-4" />
 *
 * All paths are 20×20 viewBox, single-color (currentColor), so size and color
 * are controlled via Tailwind classes on the parent.
 */
import type { SVGProps } from "react";

const PATHS: Record<string, JSX.Element> = {
  record: <circle cx="10" cy="10" r="5" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="2.5" height="11" rx="1" />
      <rect x="11.5" y="4.5" width="2.5" height="11" rx="1" />
    </>
  ),
  play: <path d="M6 4.2v11.6a.6.6 0 00.93.5l9-5.8a.6.6 0 000-1L6.93 3.7A.6.6 0 006 4.2z" />,
  mic: (
    <>
      <path d="M10 2a3 3 0 00-3 3v4a3 3 0 006 0V5a3 3 0 00-3-3z" />
      <path d="M5 9a1 1 0 112 0 3 3 0 006 0 1 1 0 112 0 5 5 0 01-4 4.9V16h2a1 1 0 110 2H7a1 1 0 110-2h2v-2.1A5 5 0 015 9z" />
    </>
  ),
  copy: (
    <>
      <rect x="6.5" y="2.5" width="9" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3.5" y="5.5" width="9" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  check: (
    <path
      d="M4.5 10.5l3.2 3.2 7.8-7.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  x: <path d="M5.7 4.3a1 1 0 011.4 0L10 7.2l2.9-2.9a1 1 0 111.4 1.4L11.4 8.6l2.9 2.9a1 1 0 01-1.4 1.4L10 10l-2.9 2.9a1 1 0 01-1.4-1.4l2.9-2.9-2.9-2.9a1 1 0 010-1.4z" />,
  alertTriangle: (
    <path
      d="M9.13 2.86l-7.5 12.5A1 1 0 002.5 17h15a1 1 0 00.87-1.5L10.87 2.86a1 1 0 00-1.74 0zM10 7.5v4.5M10 14.5v.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v4.5M10 6.7v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  shield: (
    <path
      d="M10 2.5l6 2.2v4.6c0 4-2.6 7.4-6 8.2-3.4-.8-6-4.2-6-8.2V4.7l6-2.2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  bell: (
    <path
      d="M5.2 13.5h9.6M7 13.5V9a3 3 0 016 0v4.5M10 16.5a1.3 1.3 0 002.6 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  trash: (
    <path
      d="M4.5 6h11M8 6V4.5h4V6M5.8 6l.7 9.5a1.5 1.5 0 001.5 1.5h4a1.5 1.5 0 001.5-1.5L14.2 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  arrowRight: (
    <path
      d="M4.5 10h11M11 5.5l4.5 4.5L11 14.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  sparkle: (
    <path
      d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.4 2.4M12.1 12.1l2.4 2.4M5.5 14.5l2.4-2.4M12.1 7.9l2.4-2.4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </>
  ),
  doc: (
    <path
      d="M5.5 3h6L15 6.5v9.5a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM11 3v3a1 1 0 001 1h3M7 9h6M7 12h6M7 15h4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  list: (
    <path
      d="M3.5 5.5h2M8 5.5h8.5M3.5 10h2M8 10h8.5M3.5 14.5h2M8 14.5h8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  book: (
    <path
      d="M4 4.5v11l1-.4 5 1.4 5-1.4 1 .4v-11l-1 .4-5-1.4-5 1.4L4 4.5zm6 1v10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  cog: (
    <path
      d="M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM10 1.5l1 1.7 2-.4.5 2 1.8.7-.5 2 1.4 1.5-1.4 1.5.5 2-1.8.7-.5 2-2-.4-1 1.7-1-1.7-2 .4-.5-2-1.8-.7.5-2L3.7 8l1.4-1.5-.5-2 1.8-.7.5-2 2 .4 1-1.7z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  chart: (
    <path
      d="M3.5 16.5V12M8 16.5V8M12.5 16.5v-5M17 16.5V4M3.5 16.5h13.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  quote: (
    <path
      d="M5 7.5q-1.5 0-1.5 1.5T5 10.5q1.5 0 1.5-1.5V11q0 2-2.5 2.5M13 7.5q-1.5 0-1.5 1.5t1.5 1.5q1.5 0 1.5-1.5V11q0 2-2.5 2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  mic2: (
    <path
      d="M10 2.5a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0V5A2.5 2.5 0 0010 2.5zM5.5 9.5a4.5 4.5 0 009 0M10 14v3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className,
  ...rest
}: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, "children">) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className ?? "h-4 w-4"}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
