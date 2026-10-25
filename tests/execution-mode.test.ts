import test from "node:test";
import assert from "node:assert/strict";
import { executionMode } from "../lib/execution-mode.ts";

test("explicit local and hosted profiles are accepted", () => {
  assert.equal(executionMode({ APP_EXECUTION_MODE: "local" }), "local");
  assert.equal(executionMode({ APP_EXECUTION_MODE: "hosted" }), "hosted");
});

test("Vercel defaults to hosted and development defaults to local", () => {
  assert.equal(executionMode({ VERCEL: "1", NODE_ENV: "production" }), "hosted");
  assert.equal(executionMode({ NODE_ENV: "development" }), "local");
});

test("invalid or ambiguous production profiles fail clearly", () => {
  assert.throws(() => executionMode({ APP_EXECUTION_MODE: "staging" }), /APP_EXECUTION_MODE/);
  assert.throws(() => executionMode({ NODE_ENV: "production" }), /APP_EXECUTION_MODE/);
});
