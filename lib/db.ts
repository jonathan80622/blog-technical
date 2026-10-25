import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl } from "@/lib/database-url";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({datasources:{db:{url:runtimeDatabaseUrl()}}});
// Reuse the client for the life of a warm serverless process in every mode.
globalForPrisma.prisma = db;
