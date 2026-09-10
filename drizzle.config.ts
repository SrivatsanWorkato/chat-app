import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://chat_app:chatapp@127.0.0.1:5432/chatapp",
  },
  strict: true,
  verbose: true,
});
