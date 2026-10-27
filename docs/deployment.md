# Deployment

| Piece | Runs on | Shipped by |
| --- | --- | --- |
| Next.js app | Vercel (Hobby) | `deploy.yml` → `vercel deploy --prod` |
| Postgres | Neon | `deploy.yml` → `prisma migrate deploy` |
| Go worker | AWS ECS Fargate Spot, `us-east-2`, account `635738234685` | `deploy.yml` → ECR → ECS |

`ci.yml` runs on every pull request (lint, typecheck, `next build`, `go vet`,
`go test`). Merging to `main` runs `deploy.yml`: CI again, then migrations, then
the worker and the web app in parallel. Migrations go first so neither ever
runs against an older schema. The Vercel project is not connected to the Git
repository: `deploy.yml` uploads the code with a token, so pull requests get no
preview links. If the repo is ever connected, [`vercel.json`](../vercel.json)
keeps Vercel from deploying `main` on its own.

The worker takes no inbound traffic, so there is no load balancer and no NAT
gateway. It sits in a public subnet with a public IP (to reach ECR, Neon,
Composio and OpenAI) and a security group with **no inbound rules**.

Expected cost: about $5–8/month on AWS; Neon, Vercel Hobby and GitHub Actions
are free.

## One-time setup

Names below are referenced by the workflow and the files in `deploy/`. If you
change one, change it there too.

### 0. Check your AWS access

Sign in, open **IAM → Roles** and click **Create role**. If the wizard opens,
you can do everything below; cancel out of it. If you get an "not authorized"
error, ask the account owner to grant you `AdministratorAccess` (or to run
steps 3–4 and 7–8 for you).

Switch the console region (top right) to **US East (Ohio) us-east-2** before
creating anything.

### 1. Budget alert

**Billing and Cost Management → Budgets → Create budget → Monthly cost
budget**, $10, email alert to yourself.

### 2. Neon

1. Create a project in **AWS US East 2 (Ohio)** so it is next to the worker.
2. From **Connect**, copy two strings, both ending in `?sslmode=require`:
   - **Pooled** (host contains `-pooler`) — the app and worker use this.
   - **Direct** (pooling toggled off) — migrations use this.

Keep them in a password manager, not in chat or in the repo.

### 3. AWS: storage for the worker

1. **ECR → Create repository**: private, name `somethingai-worker`. Under
   *Lifecycle policy*, add a rule keeping the 10 most recent images.
2. **CloudWatch → Log groups → Create**: `/ecs/somethingai-worker`, retention
   14 days.
3. **Systems Manager → Parameter Store → Create parameter**, three times, each
   type **SecureString**:

   | Name | Value |
   | --- | --- |
   | `/somethingai/DATABASE_URL` | Neon **pooled** string |
   | `/somethingai/COMPOSIO_API_KEY` | Composio API key |
   | `/somethingai/OPENAI_API_KEY` | OpenAI API key |

### 4. AWS: the role ECS starts the worker with

**IAM → Roles → Create role → AWS service → Elastic Container Service → Elastic
Container Service Task**. Attach `AmazonECSTaskExecutionRolePolicy`, name it
`somethingai-ecs-execution`. Then on the role: **Add permissions → Create
inline policy → JSON**, paste
[`deploy/ecs-execution-ssm-policy.json`](../deploy/ecs-execution-ssm-policy.json),
name it `read-somethingai-parameters`.

### 5. AWS: cluster, task definition, service

1. **ECS → Clusters → Create cluster**: name `somethingai`, infrastructure
   **AWS Fargate** only.
2. **ECS → Task definitions → Create new task definition with JSON**: paste
   [`deploy/worker-task-definition.json`](../deploy/worker-task-definition.json)
   as is. The image placeholder is replaced on every deploy.
3. **Cluster `somethingai` → Services → Create**:
   - Compute: **Capacity provider strategy** → `FARGATE_SPOT`, weight 1.
   - Task definition: `somethingai-worker`, latest revision.
   - Service name `somethingai-worker`, **desired tasks 0** (there is no image
     yet; step 9 raises it).
   - Deployment: leave *deployment circuit breaker* on, with rollback.
   - Networking: default VPC, its public subnets, **Public IP: on**. Security
     group: **use an existing one**, `somethingai-worker`. Create it first in
     **EC2 → Security Groups** (default VPC, no inbound rules, default
     outbound): the ECS wizard refuses to create a group with no inbound rules.

### 6. AWS: let GitHub deploy without stored keys

1. **IAM → Identity providers → Add provider → OpenID Connect**: URL
   `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. **IAM → Roles → Create role → Custom trust policy**: paste
   [`deploy/github-trust-policy.json`](../deploy/github-trust-policy.json). It
   only trusts jobs in this repo's `production` environment. Skip attaching
   managed policies, name it `somethingai-github-deploy`, create.
3. On that role, **Create inline policy → JSON**: paste
   [`deploy/github-deploy-policy.json`](../deploy/github-deploy-policy.json),
   name it `deploy-somethingai-worker`. Copy the role's **ARN**.

### 7. Vercel

1. From the repo, `npx vercel login`, then `npx vercel link` → **Create a new
   project**, name `somethingai`, **no** Git connection, default Next.js
   settings. This works without access to the GitHub repo's settings. Leave
   the build command at its default — do **not** add `prisma migrate deploy`.
2. **Settings → Environments → Production → Environment Variables**. Type
   **Config** for the `NEXT_PUBLIC_*` ones (they reach the browser anyway),
   **Secret** for the rest:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **pooled** string |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk |
   | `CLERK_SECRET_KEY` | Clerk |
   | `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhook (step 9) |
   | `NEXT_PUBLIC_APP_URL` | `https://<project>.vercel.app` or your domain |
   | `MCP_TOKEN_ENCRYPTION_KEY` | a **new** 32-byte key, see `.env.example` |
   | `COMPOSIO_API_KEY` | Composio |
   | `OPENAI_API_KEY` | OpenAI |
   | `OPENAI_MODEL` | optional |
   | `MODULATE_API_KEY` | Modulate, for speech-to-text in the prompt box |

   Keep `MCP_TOKEN_ENCRYPTION_KEY` safe: losing or changing it makes every
   stored API key undecryptable.
3. **Account Settings → Tokens → Create** a token. The org and project ids are
   in `.vercel/project.json` (or under **Project Settings → General**).

### 8. GitHub

Needs the repo owner (`Aakarsh911`): on a personal-account repo,
collaborators cannot manage environments. **Settings → Environments → New environment**
`production`, then add these **environment secrets**:

| Secret | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | ARN from step 6 |
| `DIRECT_URL` | Neon **direct** string |
| `VERCEL_TOKEN` | step 7 |
| `VERCEL_ORG_ID` | step 7 |
| `VERCEL_PROJECT_ID` | step 7 |

Optional: **Settings → Branches → Add rule** for `main` requiring the `Web` and
`Worker` CI checks.

### 9. First deploy

1. Merge to `main` (or **Actions → Deploy → Run workflow**). Watch the run.
2. Seed the catalog once, from your machine with the Neon **direct** string
   in `DIRECT_URL` and `DATABASE_URL`: `npm run db:sync-composio`, then
   `npm run db:seed`.
3. **ECS → somethingai-worker → Update service**, desired tasks **1**. In the
   task's **Logs** tab you should see `worker started`.
4. Point the outside world at the new URL: Clerk webhook endpoint
   `https://<app>/api/webhooks/clerk`, and the same origin in
   `NEXT_PUBLIC_APP_URL` (redeploy after changing it — `NEXT_PUBLIC_*` values
   are baked in at build time).
5. Smoke test: `curl https://<app>/api/health/db`, sign in, **Run now** on a
   workflow.

## Day to day

- **Rollback the worker:** ECS → service → Update → pick the previous task
  definition revision.
- **Rollback the web app:** Vercel → Deployments → previous one → Promote.
- **Worker logs:** CloudWatch log group `/ecs/somethingai-worker`.
- **Schema changes** ship with the code: commit the migration, merge, and
  `deploy.yml` applies it before anything new starts.
