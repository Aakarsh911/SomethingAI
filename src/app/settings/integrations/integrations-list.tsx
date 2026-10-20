"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ConnectField } from "@/lib/mcp/composio";
import type { McpServerView } from "@/lib/mcp/servers";

const STATUS_STYLES: Record<string, string> = {
  CONNECTED: "bg-ok/12 text-ok",
  PENDING: "bg-warn/15 text-[color:var(--warn)]",
  ERROR: "bg-destructive/10 text-destructive",
  REVOKED: "bg-muted text-muted-foreground",
};

const primaryButton =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

const input =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function IntegrationsList({
  connections,
  catalog,
  query,
  total,
  shown,
}: {
  connections: McpServerView[];
  catalog: McpServerView[];
  query: string;
  total: number;
  shown: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(id: string, request: () => Promise<Response>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Something went wrong. Please try again.");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Could not reach the server. Please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const disconnect = (server: McpServerView) =>
    mutate(server.id, () =>
      fetch(`/api/mcp/connections/${server.id}`, { method: "DELETE" }),
    );

  const custom = connections.filter((server) => server.isCustom);
  const connected = connections.filter((server) => !server.isCustom);

  function credentials(server: McpServerView) {
    return (values: Record<string, string>) =>
      mutate(server.id, () =>
        fetch(`/api/mcp/connect/${server.id}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        }),
      );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHead
          title="Connected"
          count={connected.length}
          hint="Ready to use in a workflow"
        />
        {connected.length === 0 ? (
          <EmptyNote>Nothing connected yet. Pick one from the catalog below.</EmptyNote>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {connected.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                busy={busyId === server.id || isPending}
                onDisconnect={() => disconnect(server)}
                onSubmitCredentials={credentials(server)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead
          title="Catalog"
          count={total}
          hint="Search the full directory — this page only loads a slice"
        />
        <SearchBox initial={query} />
        {total === 0 ? (
          <EmptyNote>
            No MCP servers in the catalog yet. Run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              npm run db:sync-composio
            </code>{" "}
            to import them from Composio.
          </EmptyNote>
        ) : catalog.length === 0 ? (
          <EmptyNote>Nothing matches “{query}”.</EmptyNote>
        ) : (
          <>
            {shown < total ? (
              <p className="text-xs text-subtle">
                Showing {shown} of {total.toLocaleString()}. Search to narrow results.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  busy={busyId === server.id || isPending}
                  onDisconnect={() => disconnect(server)}
                  onSubmitCredentials={credentials(server)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead
          title="Your servers"
          count={custom.length}
          hint="Bring your own MCP endpoint"
        />
        {custom.length === 0 ? (
          <EmptyNote>You have not added any servers of your own yet.</EmptyNote>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {custom.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                busy={busyId === server.id || isPending}
                onDisconnect={() => disconnect(server)}
                onSubmitCredentials={credentials(server)}
                onRemove={() =>
                  mutate(server.id, () =>
                    fetch(`/api/mcp/servers/${server.id}`, { method: "DELETE" }),
                  )
                }
              />
            ))}
          </div>
        )}
        <AddServerForm
          onSubmit={(body) =>
            mutate("new-server", () =>
              fetch("/api/mcp/servers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
            )
          }
          busy={busyId === "new-server" || isPending}
        />
      </section>
    </div>
  );
}

/**
 * Search runs on the server, because the catalog is far larger than what is
 * sent to the browser — filtering the current page client-side would only
 * ever search the couple of dozen rows already on screen.
 *
 * The term is debounced into the URL so the result is linkable and survives
 * the `router.refresh()` that follows every connect and disconnect.
 */
function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value === initial) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      // Stale banners refer to the previous action, not this search.
      params.delete("connected");
      params.delete("error");

      const query = params.toString();
      router.replace(`/settings/integrations${query ? `?${query}` : ""}`);
    }, 250);

    return () => clearTimeout(timer);
  }, [value, initial, router, searchParams]);

  return (
    <div className="relative">
      <input
        className={`${input} pl-9`}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search integrations — Slack, Jira, Stripe…"
        aria-label="Search integrations"
      />
      <svg
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
        />
      </svg>
    </div>
  );
}

function SectionHead({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <span className="font-mono text-[11px] text-subtle">{count}</span>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function ServerCard({
  server,
  busy,
  onDisconnect,
  onSubmitCredentials,
  onRemove,
}: {
  server: McpServerView;
  busy: boolean;
  onDisconnect: () => void;
  onSubmitCredentials: (values: Record<string, string>) => Promise<boolean>;
  onRemove?: () => void;
}) {
  const { connection } = server;
  const isConnected = connection?.status === "CONNECTED";
  const [showForm, setShowForm] = useState(false);

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-foreground/20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ServerIcon server={server} />
          <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-foreground">
              {server.name}
            </h3>
            {connection ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  STATUS_STYLES[connection.status] ?? STATUS_STYLES.REVOKED
                }`}
              >
                {connection.status.toLowerCase()}
              </span>
            ) : null}
          </div>
          {server.description ? (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {server.description}
            </p>
          ) : null}
          {server.categories && server.categories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {server.categories.slice(0, 3).map((category) => (
                <span
                  key={category}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {category}
                </span>
              ))}
            </div>
          ) : null}
          {connection?.accountLabel ? (
            <p className="text-sm text-muted-foreground">
              Connected as {connection.accountLabel}
            </p>
          ) : null}
          {connection?.lastError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {connection.lastError}
            </p>
          ) : null}
          {server.connectStyle === "UNAVAILABLE" && !isConnected ? (
            <p className="text-sm text-subtle">
              Needs an OAuth application to be registered before it can be
              connected.
            </p>
          ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          ) : server.connectStyle === "REDIRECT" ? (
            // A full-page navigation, not fetch: the browser has to follow the
            // redirect chain to the provider's consent screen.
            <a
              className={`${primaryButton} inline-flex items-center`}
              href={`/api/mcp/connect/${server.id}/start`}
            >
              {connection ? "Reconnect" : "Connect"}
            </a>
          ) : server.connectStyle === "CREDENTIALS" ? (
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => setShowForm((open) => !open)}
            >
              {showForm ? "Cancel" : connection ? "Reconnect" : "Connect"}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={onRemove}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {showForm && !isConnected ? (
        <CredentialForm
          server={server}
          busy={busy}
          onSubmit={async (values) => {
            const ok = await onSubmitCredentials(values);
            if (ok) setShowForm(false);
            return ok;
          }}
        />
      ) : null}

      {server.docsUrl ? (
        <a
          className="text-sm font-medium text-foreground underline underline-offset-4"
          href={server.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Setup guide
        </a>
      ) : null}
    </article>
  );
}

/**
 * Collects whatever the toolkit needs, as described by Composio.
 *
 * The fields are fetched when the form opens rather than shipped with the
 * page: they differ per toolkit — Perplexity wants one key, Mixpanel wants a
 * username, password and region — and prefetching them for a catalog of
 * ~1500 would be thousands of upstream calls to render a list.
 */
function ServerIcon({ server }: { server: McpServerView }) {
  const [failed, setFailed] = useState(false);

  if (server.iconUrl && !failed) {
    return (
      // External toolkit logos come from Composio; a broken URL falls back.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={server.iconUrl}
        alt=""
        className="size-10 shrink-0 rounded-xl border border-border bg-background object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-semibold text-foreground">
      {server.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CredentialForm({
  server,
  busy,
  onSubmit,
}: {
  server: McpServerView;
  busy: boolean;
  onSubmit: (values: Record<string, string>) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<ConnectField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/mcp/connect/${server.id}/credentials`,
        );
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
  }, [server.id]);

  if (loadError) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
    );
  }

  if (!fields) {
    return (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(values);
      }}
    >
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {server.name} needs no credentials.
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
              className={input}
              // Masked by name, since Composio does not mark fields secret.
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
              <span className="text-xs text-subtle">
                {field.description}
              </span>
            ) : null}
          </label>
        ))
      )}
      <button type="submit" className={`${primaryButton} self-start`} disabled={busy}>
        Connect {server.name}
      </button>
    </form>
  );
}

type NewServerBody = {
  name: string;
  url: string;
  description?: string;
  authType: "NONE" | "API_KEY";
  apiKey?: string;
};

function AddServerForm({
  onSubmit,
  busy,
}: {
  onSubmit: (body: NewServerBody) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        className={`${secondaryButton} self-start`}
        onClick={() => setOpen(true)}
      >
        Add a server
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const succeeded = await onSubmit({
          name,
          url,
          authType: apiKey ? "API_KEY" : "NONE",
          ...(apiKey ? { apiKey } : {}),
        });
        if (succeeded) {
          setName("");
          setUrl("");
          setApiKey("");
          setOpen(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Name
        <input
          className={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My MCP server"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Server URL
        <input
          className={input}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/mcp"
          type="url"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        API key (optional)
        <input
          className={input}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          autoComplete="off"
          placeholder="Leave blank if the server needs no auth"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={busy}>
          Add server
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
