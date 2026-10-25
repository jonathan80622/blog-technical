import test from "node:test";
import assert from "node:assert/strict";
import { vcDiscoveryDispatchHandler } from "../lib/vc-discovery-api.ts";

const req = (body: unknown) => new Request("http://localhost/api/vc-discovery/dispatch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function harness(options: { mode?: "local" | "hosted"; jobs?: string[]; failSend?: string; failMark?: string; failLease?: boolean; failSummary?: boolean; failCompensation?: string } = {}) {
  const calls: string[] = [];
  const handler = vcDiscoveryDispatchHandler({
    mode: options.mode,
    lease: async limit => {
      calls.push(`lease:${limit}`);
      if (options.failLease) throw new Error("database secret");
      return (options.jobs ?? ["a", "b"]).map(id => ({ id }));
    },
    summary: async () => {
      calls.push("summary");
      if (options.failSummary) throw new Error("database secret");
      return { counts: { PENDING: 0, QUEUED: 0, RUNNING: 0 }, maxActive: 1 };
    },
    send: async id => {
      calls.push(`send:${id}`);
      if (id === options.failSend) throw new Error("queue secret");
    },
    markDispatched: async id => { calls.push(`mark:${id}`); if (id === options.failMark) throw new Error("outbox secret"); },
    returnToPending: async (id, reason) => {
      calls.push(`pending:${id}:${reason}`);
      if (id === options.failCompensation) throw new Error("database secret");
    },
  });
  return { handler, calls };
}

test("Given malformed or unsupported dispatch input, Then no jobs are leased", async () => {
  const { handler, calls } = harness();
  for (const body of [null, [], {}, { limit: 0 }, { limit: 2 }, { limit: "5" }]) {
    assert.equal((await handler(req(body))).status, 400);
  }
  assert.equal((await handler(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
  assert.deepEqual(calls, []);
});

test("Given a valid batch, When dispatched, Then queue publication and durable state are recorded", async () => {
  const { handler, calls } = harness({ jobs: ["a"] });
  const response = await handler(req({ limit: 1 }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    state: "QUEUED", mode: "hosted", jobIds: ["a"], requested: 1, failedJobCount: 0,
    compensationFailureCount: 0, trackingFailureCount: 0,
  });
  assert.deepEqual(calls, ["lease:1", "send:a", "mark:a"]);
});

test("Given queue failures, Then failed jobs return to pending and internal errors stay private", async () => {
  const { handler, calls } = harness({ jobs: ["a"], failSend: "a" });
  const response = await handler(req({ limit: 5 }));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), {
    state: "FAILED", mode: "hosted", error: "No VC discovery jobs were queued.",
    failedJobCount: 1, compensationFailureCount: 0, trackingFailureCount: 0,
  });
  assert.deepEqual(calls, ["lease:5", "send:a", "pending:a:Queue dispatch failed; job returned to pending."]);
  assert.doesNotMatch(body, /secret/);
});

test("Given a partial batch failure, Then queued and failed counts are both visible", async () => {
  const { handler } = harness({ jobs: ["a", "b"], failSend: "b" });
  const response = await handler(req({ limit: 5 }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    state: "PARTIAL", mode: "hosted", jobIds: ["a"], requested: 5, failedJobCount: 1,
    compensationFailureCount: 0, trackingFailureCount: 0,
    message: "Some jobs could not be queued; failed jobs were returned to pending where possible.",
  });
});

test("Given queue failure and failed compensation, Then report that the durable state may need repair", async () => {
  const { handler } = harness({ jobs: ["a"], failSend: "a", failCompensation: "a" });
  const response = await handler(req({ limit: 1 }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    state: "FAILED",
    mode: "hosted",
    error: "No VC discovery jobs were queued; one or more jobs could not be returned to pending. Check the queue monitor before retrying.",
    failedJobCount: 1, compensationFailureCount: 1, trackingFailureCount: 0,
  });
});

test("Given queue publication succeeds but outbox tracking fails, Then keep the job queued for its callback", async () => {
  const { handler, calls } = harness({ jobs: ["a"], failMark: "a" });
  const response = await handler(req({ limit: 1 }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    state: "PARTIAL", mode: "hosted", jobIds: ["a"], requested: 1, failedJobCount: 0,
    compensationFailureCount: 0, trackingFailureCount: 1,
    message: "Queue accepted work, but dispatch tracking could not be updated. The jobs remain queued; check the queue monitor.",
  });
  assert.deepEqual(calls, ["lease:1", "send:a", "mark:a"]);
});

test("Given a local workflow starts, Then report started work rather than queue delivery", async () => {
  const { handler } = harness({ mode: "local", jobs: ["local-1"] });
  const response = await handler(req({ limit: 1 }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    state: "STARTED", mode: "local", jobIds: ["local-1"], requested: 1,
    failedJobCount: 0, compensationFailureCount: 0, trackingFailureCount: 0,
  });
});

test("Given local workflow tracking fails, Then report the active local run accurately", async () => {
  const { handler } = harness({ mode: "local", jobs: ["local-1"], failMark: "local-1" });
  const response = await handler(req({ limit: 1 }));
  const body = await response.json();
  assert.equal(body.state, "PARTIAL");
  assert.equal(body.mode, "local");
  assert.match(body.message, /Local workflow started/);
  assert.match(body.message, /run monitor/);
});

test("Given a lease or idle-summary database failure, Then return a safe service error", async () => {
  const failedLease = await harness({ failLease: true }).handler(req({ limit: 1 }));
  assert.equal(failedLease.status, 503);
  assert.deepEqual(await failedLease.json(), { error: "VC discovery service unavailable." });

  const failedSummary = await harness({ jobs: [], failSummary: true }).handler(req({ limit: 1 }));
  assert.equal(failedSummary.status, 503);
  assert.deepEqual(await failedSummary.json(), { error: "VC discovery service unavailable." });
});
