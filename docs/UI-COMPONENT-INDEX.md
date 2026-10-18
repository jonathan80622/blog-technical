# UI component document-ID index

This is the centralized index only. The authoritative description of each UI
part lives in the JSDoc immediately above that component in
[\`app/page.tsx\`](../app/page.tsx), so its UI, state variable, endpoint, and
backend function cannot drift apart.

| Document ID | UI component | Backend process identifier |
| --- | --- | --- |
| \`UI-HOME-001\` | \`Home\` | \`app/api/overview/route.ts::GET\` → \`data\` |
| \`UI-CONTENT-001\` | \`Content\` | View router; no request |
| \`UI-INVESTORS-001\` | \`Investors\` | \`data.investors\` from \`app/api/overview/route.ts::GET\` |
| \`UI-COMPANIES-001\` | \`Companies\` | \`data.companies\` from \`app/api/overview/route.ts::GET\` |
| \`UI-COVERAGE-001\` | \`Coverage\` | \`data.coverage\`, \`data.companies[].coverageChecks\` from \`app/api/overview/route.ts::GET\` |
| \`UI-CLAIMS-001\` | \`Claims\` | \`review\` → \`app/api/claims/[id]/route.ts::PATCH\` |
| \`UI-SOURCES-001\` | \`Sources\` | \`data.companies[].sources\` from \`app/api/overview/route.ts::GET\` |
| \`UI-VC-QUEUE-001\` | \`VcQueueStatus\` | \`load\` → \`app/api/vc-discovery/route.ts::GET\` → \`lib/vc-discovery.ts::vcDiscoverySummary\` |
| \`UI-VC-DISPATCH-001\` | \`VcDispatch\` | \`dispatch\` → \`app/api/vc-discovery/dispatch/route.ts::POST\` → \`lib/vc-discovery.ts::leaseVcDiscoveryJobs\` |
| \`UI-DIRECT-RESEARCH-001\` | \`DirectSourceResearch\` | \`submit\` → \`app/api/research/route.ts::POST\` → \`lib/source-runs.ts::createMonitoredRun\`; \`load\` → \`app/api/runs/route.ts::GET\` |
| \`UI-COLLECTION-001\` | \`Collection\` | Composition only |
| \`UI-CHAT-001\` | \`ChatUnavailable\` | No request; \`app/api/chat/route.ts\` is not invoked |
| \`UI-LAYOUT-001\` | \`Layout\` | No request |

## Rule

One document ID identifies one UI component or independently stateful component
part. When a UI component gains a backend call or a persisted progress state,
its JSDoc and this index must change in the same patch.
