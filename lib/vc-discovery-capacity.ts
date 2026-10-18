const parsedPositiveInt=(value:string|undefined) => {
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:null;
};

/**
 * Direct Prisma Postgres URLs have a small connection limit and cannot safely
 * support five simultaneous serverless workflows. A pooled runtime URL can.
 */
export function vcDiscoveryActiveLimit(databaseUrl=process.env.DATABASE_URL,override=process.env.VC_DISCOVERY_MAX_ACTIVE){
  try {
    if(!new URL(databaseUrl??"").hostname.startsWith("pooled.db.prisma.io")) return 1;
    const explicit=parsedPositiveInt(override);
    return explicit?Math.min(explicit,5):5;
  } catch { return 1; }
}
