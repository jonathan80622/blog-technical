export type ExecutionMode = "local" | "hosted";

/**
 * Local mode runs the same application with a local workflow runner. Hosted
 * mode uses Vercel Queue for VC discovery; GitHub Actions owns CI and database
 * administration, not application request handling.
 */
export function executionMode(env: Record<string, string | undefined> = process.env): ExecutionMode {
  const configured = env.APP_EXECUTION_MODE?.trim().toLowerCase();
  if (configured === "local" || configured === "hosted") return configured;
  if (configured) throw new Error("APP_EXECUTION_MODE must be 'local' or 'hosted'.");

  if (env.VERCEL === "1") return "hosted";
  if (env.NODE_ENV !== "production") return "local";
  throw new Error("Set APP_EXECUTION_MODE to 'local' or 'hosted' for production builds.");
}
