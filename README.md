This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
npm run db:migrate     # create the tables
npm run db:seed        # populate the MCP catalog (Gmail, ...)
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
| `npm run db:seed` | Sync the MCP catalog from `src/lib/mcp/catalog.ts` |
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

- **Catalog entries** (`ownerId IS NULL`) — curated, visible to everyone, and
  defined in [`src/lib/mcp/catalog.ts`](src/lib/mcp/catalog.ts). Edit that file
  and run `npm run db:seed` to add or update one. Gmail ships by default.
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
