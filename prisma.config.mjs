import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
  datasource: {
    // `prisma generate` is pure codegen and never connects to a database, but
    // Prisma 7 resolves this field eagerly and env() throws when the variable
    // is absent or empty. package.json runs generate as postinstall, so that
    // made `npm ci` fail anywhere without a .env (all of GitHub Actions).
    // Fall back to a placeholder; commands that genuinely need a database
    // still fail loudly with a connection error if DATABASE_URL is missing.
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/postgres",
  },
});
