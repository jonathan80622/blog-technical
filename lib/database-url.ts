/**
 * A direct Prisma Postgres endpoint is intentionally limited to one connection
 * per serverless process. Runtime traffic should use the pooled endpoint; this
 * is a damage-control guard for a mistaken direct runtime configuration.
 */
export function runtimeDatabaseUrl(value=process.env.DATABASE_URL) {
  if(!value) return value;
  try {
    const url=new URL(value);
    if(url.hostname.startsWith("pooled.db.prisma.io")) return value;
    url.searchParams.set("connection_limit","1");
    return url.toString();
  } catch { return value; }
}
