import { execFileSync } from "node:child_process";
import { e2eDb, resetDatabase } from "./database";

export default async function globalSetup() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
    stdio: "inherit",
  });
  await resetDatabase();
  await e2eDb.$disconnect();
}
