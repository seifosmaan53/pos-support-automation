import type { SVGProps } from "react";

export function Spinner({
  className = "h-4 w-4",
  ...rest
}: { className?: string } & Omit<SVGProps<SVGSVGElement>, "children">) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`animate-spin ${className}`}
      {...rest}
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M17.5 10a7.5 7.5 0 00-7.5-7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
