import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
}

// Prisma 7 requires an explicit driver adapter; `new PrismaClient()` with no
// arguments no longer connects on its own.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

// Reuse one client across hot reloads. Next's dev server re-evaluates modules
// on every edit; without this guard each reload would open a new connection
// pool and exhaust the database's max_connections within a few minutes.
//
// The cached *instance* is dropped when `prisma generate` produces a new
// PrismaClient class (new models, etc.). Keeping the old instance is what
// made `prisma.workflow` undefined after the workflow tables were added
// while `npm run dev` was still running.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
  prismaClient?: typeof PrismaClient;
};

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  globalForPrisma.prismaClient !== PrismaClient
) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClient = PrismaClient;
}
