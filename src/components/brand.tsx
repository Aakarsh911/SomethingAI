import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 items-center justify-center rounded-lg bg-foreground text-background shadow-sm",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none">
        <circle cx="6" cy="7" r="2.25" fill="currentColor" />
        <circle cx="18" cy="12" r="2.25" fill="currentColor" />
        <circle cx="6" cy="17" r="2.25" fill="currentColor" />
        <path
          d="M8 7.6 15.9 11.2M8 16.4l7.9-3.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-2 rounded-lg text-[15px] font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <LogoMark className="transition-transform duration-300 group-hover:rotate-[-8deg]" />
      <span>
        Something<span className="text-muted-foreground">AI</span>
      </span>
    </Link>
  );
}
