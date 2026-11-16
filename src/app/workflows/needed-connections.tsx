"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Plug, X } from "lucide-react";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { ConnectField } from "@/lib/mcp/composio";
import type { NeededConnection } from "@/lib/mcp/needed";
import { cn } from "@/lib/utils";

const inputClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function mergeNeededConnections(
  ...lists: NeededConnection[][]
): NeededConnection[] {
  const seen = new Set<string>();
  const merged: NeededConnection[] = [];
  for (const list of lists) {
    for (const need of list) {
      if (seen.has(need.server.id)) continue;
      seen.add(need.server.id);
      merged.push(need);
    }
  }
  return merged;
}

export function NeededConnectionsPanel({
  needs,
  returnTo,
  busy = false,
  onReady,
  onBeforeRedirect,
  onDismiss,
  className,
}: {
  needs: NeededConnection[];
  /** Same-origin path OAuth should land back on, e.g. `/workflows/new`. */
  returnTo: string;
  busy?: boolean;
  onReady?: () => void;
  onBeforeRedirect?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const remaining = needs.filter((need) => !done.has(need.server.id));
  const finished = remaining.length === 0 && needs.length > 0;
  const onReadyRef = useRef(onReady);
  const firedKey = useRef<string | null>(null);
  const needsKey = needs.map((need) => need.server.id).join(",");

  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    if (!finished || firedKey.current === needsKey) return;
    firedKey.current = needsKey;
    onReadyRef.current?.();
  }, [finished, needsKey]);

  if (needs.length === 0) return null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_-48px_rgb(0_0_0/0.45)]",
        className,
      )}
    >
      <header className="border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand">Connect to continue</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {remaining.length === 0
                ? "Connected. Building the workflow…"
                : remaining.length === 1
                  ? `This needs ${remaining[0].server.name}.`
                  : `This needs ${remaining.length} connections.`}
            </h3>
          </div>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Authorize here, then the draft continues with those tools available.
        </p>
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {needs.length - remaining.length} of {needs.length} connected
        </p>
      </header>

      <ul className="divide-y divide-border">
        {needs.map((need) => (
          <li key={need.server.id} className="px-5 py-4 sm:px-6">
            <ConnectionRow
              need={need}
              connected={done.has(need.server.id)}
              busy={busy}
              returnTo={returnTo}
              onBeforeRedirect={onBeforeRedirect}
              onConnected={() =>
                setDone((prev) => new Set(prev).add(need.server.id))
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConnectionRow({
  need,
  connected,
  busy,
  returnTo,
  onBeforeRedirect,
  onConnected,
}: {
  need: NeededConnection;
  connected: boolean;
  busy: boolean;
  returnTo: string;
  onBeforeRedirect?: () => void;
  onConnected: () => void;
}) {
  const { server } = need;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (connected) {
    return (
      <div className="flex items-center gap-3">
        <ServerMark server={server} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{server.name}</p>
          <p className="text-xs text-muted-foreground">Connected</p>
        </div>
        <span className="flex size-8 items-center justify-center rounded-full bg-ok/12 text-ok">
          <Check className="size-4" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <ServerMark server={server} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{server.name}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {need.reason}
          </p>
        </div>
        {server.connectStyle === "REDIRECT" ? (
          <ParticleButton
            className="h-9 shrink-0"
            disabled={busy}
            particles={false}
            icon={<Plug className="size-3.5" />}
            onClick={() => {
              onBeforeRedirect?.();
              const href = `/api/mcp/connect/${server.id}/start?returnTo=${encodeURIComponent(returnTo)}`;
              // This hits an API route that 302s to the provider, not a page.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign(href);
            }}
          >
            Connect
          </ParticleButton>
        ) : server.connectStyle === "CREDENTIALS" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            {open ? "Cancel" : "Connect"}
          </button>
        ) : (
          <p className="max-w-[12rem] text-right text-xs text-muted-foreground">
            Needs an OAuth app before it can be connected.
          </p>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {open && server.connectStyle === "CREDENTIALS" ? (
        <CredentialFields
          serverId={server.id}
          serverName={server.name}
          busy={busy}
          onError={setError}
          onConnected={onConnected}
        />
      ) : null}
    </div>
  );
}

function ServerMark({
  server,
}: {
  server: NeededConnection["server"];
}) {
  const [failed, setFailed] = useState(false);

  if (server.iconUrl && !failed) {
    return (
      // External toolkit logos come from Composio; a broken URL falls back.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={server.iconUrl}
        alt=""
        className="size-10 shrink-0 rounded-xl bg-muted object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-foreground">
      {server.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CredentialFields({
  serverId,
  serverName,
  busy,
  onError,
  onConnected,
}: {
  serverId: string;
  serverName: string;
  busy: boolean;
  onError: (value: string | null) => void;
  onConnected: () => void;
}) {
  const [fields, setFields] = useState<ConnectField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/mcp/connect/${serverId}/credentials`);
        const body = (await response.json()) as {
          fields?: ConnectField[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(body.error ?? "Could not load the connection form.");
          return;
        }
        setFields(body.fields ?? []);
      } catch {
        if (!cancelled) setLoadError("Could not load the connection form.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }
  if (!fields) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading what {serverName} needs…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {serverName} needs no extra credentials.
        </p>
      ) : (
        fields.map((field) => (
          <label
            key={field.name}
            className="flex flex-col gap-1 text-sm text-muted-foreground"
          >
            {field.displayName}
            {field.required ? "" : " (optional)"}
            <input
              className={inputClass}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              required={field.required}
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
            />
            {field.description ? (
              <span className="text-xs text-subtle">{field.description}</span>
            ) : null}
          </label>
        ))
      )}
      <ParticleButton
        className="h-9 self-start"
        disabled={busy}
        pendingLabel="Connecting"
        successLabel="Connected"
        errorLabel="Failed"
        onClick={async () => {
          onError(null);
          const response = await fetch(
            `/api/mcp/connect/${serverId}/credentials`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ values }),
            },
          );
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!response.ok) {
            const message = body?.error ?? `Could not connect ${serverName}.`;
            onError(message);
            throw new Error(message);
          }
          onConnected();
        }}
      >
        Connect {serverName}
      </ParticleButton>
    </div>
  );
}
