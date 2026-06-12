import { Button, cn, Wordmark } from "@agent-paste/ui";
import { useId, useState } from "react";

type AccessLinkBrandBarProps = {
  publicId: string;
  renderMode: string;
  title?: string | undefined;
};

export function AccessLinkBrandBar({ publicId, renderMode, title }: AccessLinkBrandBarProps) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const panelId = useId();
  const artifactTitle = title?.trim() || "Shared artifact";

  if (hidden) return null;

  return (
    <aside
      aria-label="agent-paste artifact details"
      className="fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      {open ? (
        <section
          id={panelId}
          aria-label="Artifact metadata"
          className="absolute bottom-[calc(100%+8px)] left-0 w-[320px] max-w-[calc(100vw-2rem)] rounded-sm border border-rule-strong bg-background p-4 text-foreground"
        >
          <div className="flex items-center">
            <h2>
              <Wordmark small />
            </h2>
          </div>
          <dl className="mt-4 grid gap-3">
            <div>
              <dt className="font-mono text-mono-sm uppercase tracking-wide text-subtle">Artifact</dt>
              <dd className="mt-1 truncate text-base font-medium">{artifactTitle}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="font-mono text-mono-sm uppercase tracking-wide text-subtle">Render mode</dt>
                <dd className="mt-1 font-mono text-mono text-foreground">{renderMode}</dd>
              </div>
              <div>
                <dt className="font-mono text-mono-sm uppercase tracking-wide text-subtle">Access link</dt>
                <dd className="mt-1 break-all font-mono text-mono text-foreground">{publicId}</dd>
              </div>
            </div>
          </dl>
          <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => setHidden(true)}>
            Hide toggle
          </Button>
        </section>
      ) : null}

      <button
        type="button"
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={open ? "Close agent-paste.sh artifact details" : "Open agent-paste.sh artifact details"}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-11 items-center rounded-sm border border-rule-strong bg-background px-3",
          "text-left transition-colors hover:bg-surface-2",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <Wordmark small />
      </button>
    </aside>
  );
}
