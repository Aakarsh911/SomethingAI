"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { McpServerView } from "@/lib/mcp/servers";

const STATUS_STYLES: Record<string, string> = {
  CONNECTED:
    "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  PENDING:
    "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ERROR: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  REVOKED: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
};

const primaryButton =
  "h-9 cursor-pointer rounded-full border border-transparent bg-black px-4 text-sm font-medium text-neutral-50 transition-all duration-200 hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]";

const secondaryButton =
  "h-9 cursor-pointer rounded-full border border-[#ebebeb] bg-transparent px-4 text-sm font-medium text-black transition-all duration-200 hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#1a1a1a] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]";

const input =
  "h-9 w-full rounded-lg border border-[#ebebeb] bg-transparent px-3 text-sm text-black outline-none focus:border-neutral-400 dark:border-[#1a1a1a] dark:text-[#ededed]";

export function IntegrationsList({ servers }: { servers: McpServerView[] }) {
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

  const catalog = servers.filter((server) => !server.isCustom);
  const custom = servers.filter((server) => server.isCustom);

  return (
    <div className="flex flex-col gap-10">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <Section title="Available">
        {catalog.length === 0 ? (
          <EmptyNote>
            No MCP servers in the catalog yet. Run <code>npm run db:seed</code>{" "}
            to add them.
          </EmptyNote>
        ) : (
          catalog.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              busy={busyId === server.id || isPending}
              onDisconnect={() =>
                mutate(server.id, () =>
                  fetch(`/api/mcp/connections/${server.id}`, {
                    method: "DELETE",
                  }),
                )
              }
            />
          ))
        )}
      </Section>

      <Section title="Your servers">
        {custom.length === 0 ? (
          <EmptyNote>
            You have not added any servers of your own yet.
          </EmptyNote>
        ) : (
          custom.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              busy={busyId === server.id || isPending}
              onDisconnect={() =>
                mutate(server.id, () =>
                  fetch(`/api/mcp/connections/${server.id}`, {
                    method: "DELETE",
                  }),
                )
              }
              onRemove={() =>
                mutate(server.id, () =>
                  fetch(`/api/mcp/servers/${server.id}`, { method: "DELETE" }),
                )
              }
            />
          ))
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
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[#ebebeb] px-4 py-6 text-center text-sm text-[#666] dark:border-[#1a1a1a] dark:text-[#999]">
      {children}
    </p>
  );
}

function ServerCard({
  server,
  busy,
  onDisconnect,
  onRemove,
}: {
  server: McpServerView;
  busy: boolean;
  onDisconnect: () => void;
  onRemove?: () => void;
}) {
  const { connection } = server;
  const isConnected = connection?.status === "CONNECTED";

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[#ebebeb] p-4 dark:border-[#1a1a1a]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-black dark:text-[#ededed]">
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
            <p className="text-sm text-[#666] dark:text-[#999]">
              {server.description}
            </p>
          ) : null}
          <p className="font-mono text-xs break-all text-[#999] dark:text-[#666]">
            {server.url ?? `composio:${server.composioToolkit}`}
          </p>
          {connection?.accountLabel ? (
            <p className="text-sm text-[#666] dark:text-[#999]">
              Connected as {connection.accountLabel}
            </p>
          ) : null}
          {connection?.lastError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {connection.lastError}
            </p>
          ) : null}
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
          ) : server.authType === "COMPOSIO" ? (
            // A full-page navigation, not fetch: the browser has to follow the
            // redirect chain to the provider's consent screen.
            <a
              className={`${primaryButton} inline-flex items-center`}
              href={`/api/mcp/connect/${server.id}/start`}
            >
              {connection ? "Reconnect" : "Connect"}
            </a>
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

      {server.docsUrl ? (
        <a
          className="text-sm font-medium text-black underline underline-offset-4 dark:text-[#ededed]"
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
      className="flex flex-col gap-3 rounded-xl border border-[#ebebeb] p-4 dark:border-[#1a1a1a]"
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
      <label className="flex flex-col gap-1 text-sm text-[#666] dark:text-[#999]">
        Name
        <input
          className={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My MCP server"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[#666] dark:text-[#999]">
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
      <label className="flex flex-col gap-1 text-sm text-[#666] dark:text-[#999]">
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
