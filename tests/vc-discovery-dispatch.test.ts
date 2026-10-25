import test from "node:test";
import assert from "node:assert/strict";
import { createVcDiscoverySender } from "../lib/vc-discovery-dispatch.ts";

test("local profile claims the database job and starts the shared workflow", async () => {
  const calls: string[] = [];
  const send = createVcDiscoverySender("local", {
    claim: async id => { calls.push(`claim:${id}`); return true; },
    startLocal: async id => { calls.push(`workflow:${id}`); },
    enqueueHosted: async id => { calls.push(`queue:${id}`); },
  });

  await send("job-1");
  assert.deepEqual(calls, ["claim:job-1", "workflow:job-1"]);
});

test("hosted profile publishes to Vercel Queue without claiming in the request", async () => {
  const calls: string[] = [];
  const send = createVcDiscoverySender("hosted", {
    claim: async id => { calls.push(`claim:${id}`); return true; },
    startLocal: async id => { calls.push(`workflow:${id}`); },
    enqueueHosted: async id => { calls.push(`queue:${id}`); },
  });

  await send("job-2");
  assert.deepEqual(calls, ["queue:job-2"]);
});

test("local profile surfaces a lost claim instead of starting a duplicate workflow", async () => {
  let started = false;
  const send = createVcDiscoverySender("local", {
    claim: async () => false,
    startLocal: async () => { started = true; },
    enqueueHosted: async () => undefined,
  });

  await assert.rejects(send("job-3"), /could not claim/);
  assert.equal(started, false);
});
