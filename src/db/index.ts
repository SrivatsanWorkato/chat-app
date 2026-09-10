import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const globalForDb = globalThis as unknown as { __chatAppSql?: postgres.Sql };

export const sql = globalForDb.__chatAppSql ?? postgres(connectionString, { max: 5 });
globalForDb.__chatAppSql = sql;

export const db = drizzle(sql, { schema });
