import { defineConfig } from "prisma/config";

// Prisma 7 reads the CLI's connection URL from here instead of the schema. The app itself
// always passes a driver adapter (D1 on Workers, SQLite in Node tests) to PrismaClient.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
});
