import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const extensions = await db.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  if (extensions.length !== 1) throw new Error("pgvector extension was not installed by the migration.");
  const tables = await db.$queryRaw`SELECT to_regclass('public."DocumentChunk"')::text AS chunks, to_regclass('public."Job"')::text AS jobs`;
  if (!tables[0]?.chunks || !tables[0]?.jobs) throw new Error("Research tables are missing after migration.");
  console.log("Database migration verified: pgvector, DocumentChunk, and Job are available.");
} finally {
  await db.$disconnect();
}
