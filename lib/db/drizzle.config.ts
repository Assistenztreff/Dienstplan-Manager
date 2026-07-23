import { defineConfig } from "drizzle-kit";
import path from "path";
import { normalizeDatabaseUrl } from "./src/database-url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL),
  },
});
