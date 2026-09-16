# SomethingAI

Natural language → MCP workflow graph platform.

A user describes an automation in plain English — for example, *“every day at 9am, message my co-founder for a status update, and based on their reply either log it or ping me about a blocker.”* The app compiles that description into a directed graph of MCP (Model Context Protocol) tool calls with conditional branching, stores the graph, and executes it on a schedule or trigger. Runs can wait hours or days, retry a failed step, and hold for human approval before a risky action such as sending a message.

Think Zapier or n8n, except the automation is described in natural language and driven by an LLM agent calling MCP tools, not a static if-this-then-that wizard.

## Core user flow

1. The user describes a workflow in a chat interface.
2. The LLM compiles it into a structured workflow graph (JSON): nodes are triggers, MCP tool calls, LLM transforms, branches, and waits; edges are data flow and control flow.
3. The compiled graph is shown back in plain English *and* as an editable visual node graph (React Flow) before saving.
4. Saved workflows run on their trigger — a cron-style time trigger, or an event such as an incoming email or Slack message.
5. Execution is a durable workflow engine (Temporal), so a run can pause for a reply, retry a failed step, or wait for human approval without losing state.
6. Every run is logged (per-node input/output, status, timestamps) and viewable in run history / a live execution view.

## What is built now

- **Auth and tenants:** Clerk, with a local `User` row for application data.
- **MCP connections:** `/settings/integrations` — catalog servers (Composio-brokered, e.g. Gmail) and user-owned custom servers. Tokens stay with Composio or are AES-256-GCM encrypted API keys.
- **Workflow studio:** `/workflows` — sidebar to add and delete workflows (delete asks for confirmation), React Flow canvas, right-click → add a node from the user's connected MCP servers, drag handles to connect nodes.
- **Graph storage:** Postgres. `Workflow.graph` is the working copy (JSONB). Each save also appends an immutable `WorkflowVersion` row so history can be restored without rewriting earlier snapshots. Node kinds are validated by Zod in [`src/lib/workflows/graph.ts`](src/lib/workflows/graph.ts) before anything is written — the database does not enforce blob shape.
- **Run tables:** `WorkflowRun` (with a `graphSnapshot` of what actually executed) and `WorkflowStepRun` exist for the future executor.

The chat compiler, Temporal interpreter, live run highlighting, and approval gates are not built yet. The studio writes the same graph format those pieces will consume.

## Tech stack

| Layer | Choice | Role |
| --- | --- | --- |
| Frontend | Next.js (App Router) | App, studio, integrations |
| Graph canvas | React Flow (xyflow) | Visual editor and, later, live execution highlighting |
| NL → graph compiler | Claude with structured/tool-call output, Zod-validated server-side | Never persist raw LLM JSON |
| Graph & run storage | Postgres via Prisma 7 | `Workflow`, `WorkflowVersion`, `WorkflowRun`, `WorkflowStepRun`; graphs as JSONB |
| Execution engine | Temporal (TypeScript SDK) | Durable waits, per-activity retries, approval signals |
| MCP | `@modelcontextprotocol/sdk` + Composio for hosted auth | Isolated activity per server call |
| Auth | Clerk | Multi-tenant; viewer / editor / admin later |
| Secrets | Encrypted columns today; Infisical/Doppler/KMS later | OAuth tokens never stored in the clear |
| Real-time execution | Redis pub/sub + WebSockets (or Supabase Realtime) | Node-by-node canvas updates |
| Observability | OpenTelemetry + Axiom or Sentry | Native Temporal traces |
| Deployment | Vercel (app), Temporal Cloud or Fly.io, MCP servers on Fly.io / Cloud Run | |

## Key architectural decision

The compiler emits a **generic graph** interpreted by **one generic Temporal workflow**. Users create arbitrary shapes at runtime — we cannot redeploy code for every new workflow — so Temporal is a graph interpreter, not a generated template.

The graph is the source of truth, not the chat transcript. Chat is one way to edit the graph; the visual editor must represent and modify anything the compiler produces.

## Design principles

- **Never auto-execute risky actions on a new workflow.** First runs, and anything that sends a message, posts publicly, or spends money, require human approval by default. Auto-approval is opt-in after clean runs.
- **Isolate failure per MCP node.** One dead server fails one node, not the run.
- **Idempotency matters.** Retrying a step must never double-send a message.
- **Show the plain-English interpretation before saving.** Catch misunderstandings before a workflow goes live.
- **The graph is the source of truth.** The editor and the compiler share one Zod schema.

## Not building yet

- A no-code visual-only builder with no NL layer — the compiler is the differentiator.
- Our own OAuth layer for every service — Composio is the connection broker unless it falls short.
- Enterprise governance (SSO, SCIM, org-wide policy) — post-MVP.

## Getting Started

```bash
nvm use          # Node 22, see .nvmrc
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Signed-in users land on `/workflows`.

## Database

PostgreSQL via [Prisma 7](https://www.prisma.io/docs). Local development uses a
Postgres server on your own machine; production uses a hosted database.

> A local database is reachable only from your machine. Git tracks the schema
> and migrations, never the data or credentials (`.env*` is gitignored), so each
> developer rebuilds their own local copy from the committed migrations.

### First-time setup

**1. Node 22** (declared in `.nvmrc`):

```bash
nvm use
```

**2. Install and start PostgreSQL 16** (Ubuntu / WSL):

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

**3. Create the role and database:**

```bash
sudo -u postgres psql -c "CREATE ROLE somethingai WITH LOGIN PASSWORD 'devpassword' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE somethingai_dev OWNER somethingai;"
```

`CREATEDB` is required, not cosmetic: `prisma migrate dev` creates a temporary
*shadow database* to detect schema drift and fails without that privilege.

**4. Configure environment variables:**

```bash
cp .env.example .env   # then edit the credentials to match step 3
```

**5. Install dependencies and apply migrations:**

```bash
npm install            # `postinstall` runs `prisma generate`
npm run db:migrate         # create the tables
npm run db:sync-composio   # import Composio's ~1500 integrations
npm run db:seed            # apply the curated overrides in catalog.ts
```

### Verifying the connection

```bash
npm run dev
curl http://localhost:3000/api/health/db
# => {"ok":true,"latencyMs":12}
```

A `503` returns the driver's error message, which distinguishes an auth failure
from a wrong host or a missing database.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply existing migrations (production/CI) |
| `npm run db:seed` | Apply the curated overrides in `src/lib/mcp/catalog.ts` |
| `npm run db:sync-composio` | Import Composio's toolkit directory into the catalog |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Browse data in a GUI at `localhost:5555` |
| `npm run typecheck` | Type-check without emitting |

### How the connection is wired

Prisma 7 uses two separate paths to the database, which is why there are two
environment variables:

- **`DATABASE_URL`** — used by the app at runtime through the driver adapter in
  [`src/lib/db.ts`](src/lib/db.ts). In production this should be a **pooled**
  connection string, because serverless functions open many short-lived
  connections.
- **`DIRECT_URL`** — used by the Prisma CLI via
  [`prisma7.config.ts`](prisma7.config.ts). Must be **direct/unpooled**, because
  migrations run DDL that a transaction-mode pooler cannot handle.

Locally both hold the same value. The schema itself
([`prisma/schema.prisma`](prisma/schema.prisma)) declares no URL at all.

The generated client is written to `src/generated/prisma` and is gitignored;
`npm install` recreates it via `postinstall`.

### Changing the schema

Edit `prisma/schema.prisma`, then:

```bash
npm run db:migrate
```

### Production (database)

Create a hosted Postgres (e.g. [Neon](https://neon.tech)), then set in your host's
environment variables:

- `DATABASE_URL` = pooled string (host contains `-pooler`) + `?sslmode=require`
- `DIRECT_URL` = direct string + `?sslmode=require`

Set the build command so schema changes ship with the code that needs them:

```bash
prisma generate && prisma migrate deploy && next build
```

## MCP integrations

Users connect [Model Context Protocol](https://modelcontextprotocol.io) servers
at `/settings/integrations`. Two kinds of server live in the `McpServer` table:

- **Catalog entries** (`ownerId IS NULL`) — visible to everyone. Nearly all of
  them are imported from Composio's toolkit directory by
  `npm run db:sync-composio`, which mirrors ~1500 integrations into the table
  and disables any that Composio has since dropped. Re-run it whenever you want
  a fresh list; it is idempotent.

  [`src/lib/mcp/catalog.ts`](src/lib/mcp/catalog.ts) is the override layer on
  top: entries there win over whatever Composio supplies, which is how Gmail
  gets a hand-written description rather than the generic one. Run
  `npm run db:seed` *after* the sync, or the sync will overwrite the overrides.

  How a catalog entry is connected depends on its auth scheme, pinned at sync
  time in `composioAuthScheme`:

  | | Count | Connecting |
  | --- | --- | --- |
  | Composio-managed OAuth, and dynamic-registration OAuth | ~208 | Redirect to the provider's consent screen |
  | API key, bearer token, basic auth, no auth | ~1280 | Inline form, fields described by Composio |
  | OAuth that Composio does not manage | ~55 | Not connectable until an auth config id is supplied (see below) |
- **Custom servers** (`ownerId` set) — added by a user through the UI, visible
  only to them. These support no auth or an API key. The hosted flow is
  catalog-only, because it is tied to a Composio toolkit rather than to an
  arbitrary URL.

### How authorization works

Catalog servers authorize through [Composio](https://composio.dev), which runs
the provider's OAuth flow, stores and refreshes the tokens, and hosts the MCP
server. **This app never sees a Google access token.** A connection is just a
Composio connected account id on the `UserMcpConnection` row.

The one credential this app does store is the API key for a custom API-key
server, encrypted with AES-256-GCM
([`src/lib/crypto.ts`](src/lib/crypto.ts)). `listServersForUser` returns a view
type with no field for it, so it cannot reach the client by accident.

The MCP endpoint itself is **not** stored. Composio mints a short-lived
per-user session URL, and its headers carry credentials, so
`getMcpSessionForUser`
([`src/lib/mcp/connections.ts`](src/lib/mcp/connections.ts)) creates one at the
point of use and it must stay server-side. One session spans every toolkit the
user has connected, which is how Composio's tool router is designed.

`McpConnectAttempt` holds the in-flight redirect. Composio's callback says what
happened and which account resulted, but nothing trustworthy about whose
browser it is — so an unguessable `state` travels through the round trip, and
the user and server are read from that row rather than the query string.

### Enabling Gmail

Create an account at [app.composio.dev](https://app.composio.dev), copy an API
key from **Settings → API Keys**, and set it in `.env`:

```bash
COMPOSIO_API_KEY="..."
```

That is the whole setup. On the first connect the app creates a
Composio-managed Gmail auth config and caches its id on the server row, so
there is no Google Cloud project, no OAuth client, and no Workspace Developer
Preview enrollment. (Google's own Gmail MCP server would also work, but it is
gated behind that preview programme.)

To use your own Google OAuth credentials instead, build an auth config in the
Composio dashboard and set `COMPOSIO_GMAIL_AUTH_CONFIG_ID` to its `ac_...` id.
The pattern is `COMPOSIO_<TOOLKIT>_AUTH_CONFIG_ID`, so it generalises to any
toolkit you add to the catalog.

### Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/mcp/servers` | Catalog + your servers, with connection state |
| `POST` | `/api/mcp/servers` | Add a custom server |
| `DELETE` | `/api/mcp/servers/:id` | Remove a custom server you own |
| `GET` | `/api/mcp/connections` | Only the servers you have connected |
| `DELETE` | `/api/mcp/connections/:serverId` | Revoke upstream and disconnect |
| `GET` | `/api/mcp/connect/:serverId/start` | Begin authorization (a redirect) |
| `GET` | `/api/mcp/connect/callback` | Composio redirect target |
| `GET` | `/api/workflows` | List the caller's workflows |
| `POST` | `/api/workflows` | Create a workflow (empty graph = one trigger) |
| `GET` | `/api/workflows/:id` | Working graph + version list |
| `PATCH` | `/api/workflows/:id` | Rename or save a new graph revision |
| `DELETE` | `/api/workflows/:id` | Delete a workflow and its history |
| `POST` | `/api/workflows/:id/versions/:revision/restore` | Copy an old snapshot forward as a new revision |

### Adding another toolkit

Anything in [Composio's toolkit catalog](https://composio.dev/toolkits) works.
Add an entry to `src/lib/mcp/catalog.ts` with `authType: "COMPOSIO"` and the
toolkit slug, then run `npm run db:seed`:

```ts
{
  slug: "slack",
  name: "Slack",
  description: "Read and post messages in your Slack workspace.",
  url: null,
  transport: "HTTP",
  authType: "COMPOSIO",
  composioToolkit: "slack",
  iconUrl: null,
  docsUrl: "https://composio.dev/toolkits/slack",
}
```

## Workflow graphs and version history

`Workflow.graph` is the editor's working copy. On create and on every graph
save, `save` also inserts a `WorkflowVersion` row (`revision`, `graph` JSONB,
`note`). Restoring v3 copies that blob onto the working copy and appends a
*new* revision (`Restored from v3`) — older rows are never updated.

Postgres does not preserve JSON object key order. Compare graphs with a deep
equality check (or stringify after sorting keys), not a raw `JSON.stringify`.
The Zod schema in `src/lib/workflows/graph.ts` is what keeps malformed graphs
out of both tables.
