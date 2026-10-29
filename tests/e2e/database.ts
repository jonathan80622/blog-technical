import { PrismaClient } from "@prisma/client";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL must point to a disposable migrated Postgres database.");

const databaseName = new URL(url).pathname.slice(1);
if (!databaseName.endsWith("_e2e")) throw new Error("Refusing to run browser tests unless the database name ends in _e2e.");

export const e2eDb = new PrismaClient({ datasources: { db: { url } } });

/** Keep every journey isolated without relying on browser-level API stubs. */
export async function resetDatabase() {
  const rows = await e2eDb.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (!rows.length) throw new Error("The E2E database has no migrated tables.");
  const tables = rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
  await e2eDb.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
