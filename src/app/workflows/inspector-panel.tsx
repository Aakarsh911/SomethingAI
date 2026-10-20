import type { ReactNode } from "react";
import { X } from "lucide-react";

/** The side sheet that opens over the canvas when a node is selected. */
export function InspectorPanel({
  eyebrow,
  title,
  monospaceTitle = false,
  closeLabel,
  onClose,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  /** For titles that are identifiers, like a tool slug. */
  monospaceTitle?: boolean;
  closeLabel: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="glass-morph absolute top-4 right-4 bottom-4 z-30 flex w-[22rem] flex-col overflow-hidden rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
          <p
            className={`mt-0.5 truncate text-sm font-medium text-foreground ${
              monospaceTitle ? "font-mono text-xs" : ""
            }`}
          >
            {title}
          </p>
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

      {footer ? (
        <footer className="shrink-0 border-t border-white/10 px-4 py-3">{footer}</footer>
      ) : null}
    </aside>
  );
}
