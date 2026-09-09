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
npm run db:migrate     # no-op until the schema has models
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
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Browse data in a GUI at `localhost:5555` |

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

### Adding your first model

The schema intentionally ships with **no models** — only the connection is set
up. Add a model to `prisma/schema.prisma`, then:

```bash
npm run db:migrate
```

### Production

Create a hosted Postgres (e.g. [Neon](https://neon.tech)), then set in your host's
environment variables:

- `DATABASE_URL` = pooled string (host contains `-pooler`) + `?sslmode=require`
- `DIRECT_URL` = direct string + `?sslmode=require`

Set the build command so schema changes ship with the code that needs them:

```bash
prisma generate && prisma migrate deploy && next build
```
