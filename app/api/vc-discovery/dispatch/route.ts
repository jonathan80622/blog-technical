import { start } from "workflow/api";
import { claimVcDiscoveryJob, VC_DISCOVERY_TOPIC, leaseVcDiscoveryJobs, markVcDiscoveryDispatched, returnVcDiscoveryJobToPending, vcDiscoverySummary } from "@/lib/vc-discovery";
import { vcDiscoveryDispatchHandler } from "@/lib/vc-discovery-api";
import { executionMode } from "@/lib/execution-mode";
import { createVcDiscoverySender } from "@/lib/vc-discovery-dispatch";
import { discoverInvestorSources } from "@/workflows/discover-investor";

export const runtime="nodejs";

const mode = executionMode();
const send = createVcDiscoverySender(mode, {
  claim: claimVcDiscoveryJob,
  startLocal: async jobId => { await start(discoverInvestorSources, [jobId]); },
  enqueueHosted: async jobId => {
    const { send } = await import("@vercel/queue");
    await send(VC_DISCOVERY_TOPIC,{jobId},{idempotencyKey:`vc-discovery:${jobId}`,retentionSeconds:86_400});
  },
});

export const POST = vcDiscoveryDispatchHandler({
  mode,
  lease: limit => leaseVcDiscoveryJobs(limit),
  summary: vcDiscoverySummary,
  send,
  markDispatched: markVcDiscoveryDispatched,
  returnToPending: returnVcDiscoveryJobToPending,
});
