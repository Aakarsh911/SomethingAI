import "dotenv/config";
import { defineConfig } from "prisma/config";

// This config is used by the Prisma CLI only (migrate, db pull, studio).
//
// Note the split: CLI commands run DDL and therefore need a DIRECT, unpooled
// connection, whereas the running app connects through the driver adapter in
// src/lib/db.ts using DATABASE_URL (which in production is a POOLED string).
// Locally both variables hold the same value, so DIRECT_URL is optional.
const directUrl = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: directUrl,
  },
});
