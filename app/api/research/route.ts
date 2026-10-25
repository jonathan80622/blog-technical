import { start } from "workflow/api";
import { createMonitoredRun, event } from "@/lib/source-runs";
import { collectSource } from "@/workflows/collect-source";
import { db } from "@/lib/db";
import { researchHandler } from "@/lib/research-api";

export const runtime = "nodejs";
export const POST = researchHandler({
  create: createMonitoredRun,
  dispatch: id => start(collectSource, [id]),
  attach: (id, workflowRunId) => db.sourceRun.update({where: {id}, data: {workflowRunId}}),
  failed: (id, message) => event(id, "FAILED", "Dispatch failed", message)
});
