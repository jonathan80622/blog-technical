import type { ExecutionMode } from "@/lib/execution-mode";

export type VcDiscoveryDispatchAdapters = {
  claim: (jobId: string) => Promise<boolean>;
  startLocal: (jobId: string) => Promise<void>;
  enqueueHosted: (jobId: string) => Promise<void>;
};

/** Selects the delivery mechanism while keeping the lease and workflow shared. */
export function createVcDiscoverySender(
  mode: ExecutionMode,
  adapters: VcDiscoveryDispatchAdapters,
) {
  return async (jobId: string) => {
    if (mode === "hosted") return adapters.enqueueHosted(jobId);
    if (!await adapters.claim(jobId)) throw new Error("Local worker could not claim the queued job.");
    return adapters.startLocal(jobId);
  };
}
