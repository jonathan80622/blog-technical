type DiscoveryJob = { id: string };
type DiscoverySummary = { counts: Record<string, number>; maxActive: number };
type DeliveryMode = "local" | "hosted";
type Dependencies = {
  mode?: DeliveryMode;
  lease: (limit: 1 | 5) => Promise<DiscoveryJob[]>;
  summary: () => Promise<DiscoverySummary>;
  send: (jobId: string) => Promise<void>;
  markDispatched: (jobId: string) => Promise<void>;
  returnToPending: (jobId: string, message: string) => Promise<void>;
};

/** HTTP boundary for the two supported dispatch actions shown in Collection. */
export function vcDiscoveryDispatchHandler(deps: Dependencies) {
  const mode = deps.mode ?? "hosted";
  return async (request: Request): Promise<Response> => {
    let input: unknown;
    const effects: unknown[] = [];
    const respond = (body: unknown, status = 200) => {
      emitTestTrace({handler: 'vcDiscoveryDispatchHandler', input, effects, response: {status, body}});
      return Response.json(body, {status});
    };
    const unavailable = () => respond({ error: "VC discovery service unavailable." }, 503);
    try {
      input = await request.json();
    } catch {
      return respond({ error: "Invalid JSON body." }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return respond({ error: "Expected an object." }, 400);
    }
    const limit = (input as Record<string, unknown>).limit;
    if (limit !== 1 && limit !== 5) {
      return respond({ error: "limit must be 1 or 5." }, 400);
    }

    let jobs: DiscoveryJob[];
    try {
      jobs = await deps.lease(limit); effects.push({operation: 'lease', input: {limit}, output: jobs});
    } catch (error) {
      effects.push({operation: 'lease', input: {limit}, threw: error instanceof Error ? error.message : String(error)});
      return unavailable();
    }
    if (!jobs.length) {
      try {
        const summary = await deps.summary(); effects.push({operation: 'summary', output: summary});
        const pending = (summary.counts.PENDING || 0) + (summary.counts.FAILED || 0);
        const active = (summary.counts.QUEUED || 0) + (summary.counts.RUNNING || 0);
        const message = pending
          ? `VC jobs are waiting but all ${summary.maxActive} discovery slot${summary.maxActive === 1 ? " is" : "s are"} active. Try again after one completes.`
          : active
            ? "All available VC discovery work is already in progress."
            : "No market-map jobs are prepared. Prepare candidates through the explicit market-map batch before dispatching them.";
        return respond({ state: "IDLE", message });
      } catch (error) {
        effects.push({operation: 'summary', threw: error instanceof Error ? error.message : String(error)});
        return unavailable();
      }
    }

    const queued: string[] = [];
    let failedJobCount = 0;
    let compensationFailureCount = 0;
    let trackingFailureCount = 0;
    for (const job of jobs) {
      try {
        await deps.send(job.id); effects.push({operation: 'send', input: {jobId: job.id}});
        queued.push(job.id);
      } catch (error) {
        effects.push({operation: 'send', input: {jobId: job.id}, threw: error instanceof Error ? error.message : String(error)});
        failedJobCount++;
        try {
          const message = mode === "local" ? "Local workflow start failed; job returned to pending." : "Queue dispatch failed; job returned to pending.";
          await deps.returnToPending(job.id, message); effects.push({operation: 'returnToPending', input: {jobId: job.id, message}});
        } catch (error) {
          effects.push({operation: 'returnToPending', input: {jobId: job.id}, threw: error instanceof Error ? error.message : String(error)});
          compensationFailureCount++;
        }
        continue;
      }
      try {
        await deps.markDispatched(job.id); effects.push({operation: 'markDispatched', input: {jobId: job.id}});
      } catch (error) {
        effects.push({operation: 'markDispatched', input: {jobId: job.id}, threw: error instanceof Error ? error.message : String(error)});
        // Delivery or the local workflow start succeeded. Keep its state for the
        // active worker; resetting it to PENDING could start duplicate work.
        trackingFailureCount++;
      }
    }

    if (!queued.length) {
      return respond({
        state: "FAILED",
        mode,
        error: compensationFailureCount
          ? mode === "local"
            ? "No local workflows were started; one or more jobs could not be returned to pending. Check the run monitor before retrying."
            : "No VC discovery jobs were queued; one or more jobs could not be returned to pending. Check the queue monitor before retrying."
          : mode === "local" ? "No local discovery workflows were started." : "No VC discovery jobs were queued.",
        failedJobCount,
        compensationFailureCount,
        trackingFailureCount,
      }, 503);
    }
    return respond({
      state: failedJobCount || trackingFailureCount ? "PARTIAL" : mode === "local" ? "STARTED" : "QUEUED",
      mode,
      jobIds: queued,
      requested: limit,
      failedJobCount,
      compensationFailureCount,
      trackingFailureCount,
      message: trackingFailureCount
        ? mode === "local"
          ? "Local workflow started, but dispatch tracking could not be updated. Check the run monitor."
          : "Queue accepted work, but dispatch tracking could not be updated. The jobs remain queued; check the queue monitor."
        : failedJobCount
          ? mode === "local"
            ? "Some local workflows could not be started; failed jobs were returned to pending where possible."
            : "Some jobs could not be queued; failed jobs were returned to pending where possible."
          : undefined,
    }, 202);
  };
}
import { emitTestTrace } from './test-trace.ts';
