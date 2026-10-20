import type { ReactNode } from "react";

/** The side panel that opens over the canvas when a node is selected. */
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
    <aside className="absolute top-0 right-0 z-30 flex h-full w-80 flex-col border-l border-[#ebebeb] bg-white dark:border-[#1a1a1a] dark:bg-neutral-950">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[#ebebeb] px-3 py-2 dark:border-[#1a1a1a]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
            {eyebrow}
          </p>
          <p
            className={`truncate text-xs text-black dark:text-[#ededed] ${
              monospaceTitle ? "font-mono" : ""
            }`}
          >
            {title}
          </p>
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          className="cursor-pointer rounded px-1 text-sm text-[#666] hover:text-black dark:hover:text-[#ededed]"
          onClick={onClose}
        >
          &times;
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>

      {footer ? (
        <footer className="shrink-0 border-t border-[#ebebeb] px-3 py-2 dark:border-[#1a1a1a]">
          {footer}
        </footer>
      ) : null}
    </aside>
  );
}
