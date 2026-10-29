import test from "node:test";
import assert from "node:assert/strict";
import { UnresolvedSourceError, unresolvedSourceReason } from "../lib/source-outcome.ts";
import { sourceCoverageResult } from "../lib/source-coverage.ts";

test("recognizes terminal source-assessment outcomes without treating infrastructure errors as unresolved",()=>{
  assert.equal(unresolvedSourceReason(new UnresolvedSourceError("browser_render_required","renderer required")),"browser_render_required");
  assert.equal(unresolvedSourceReason(new Error("database connection failed")),undefined);
});

test("coverage distinguishes a completed empty search from failed or partial collection",()=>{
  assert.deepEqual(sourceCoverageResult("HIRING_SIGNALS",0,0,0),{
    outcome:"SEARCHED_UNRESOLVED",reason:"Search completed; no eligible official hiring_signals source was found."
  });
  assert.deepEqual(sourceCoverageResult("TECHNICAL_SOURCES",2,1,1),{
    outcome:"FAILED",reason:"Indexed 1 of 2 eligible official source(s); 1 source attempt(s) failed."
  });
  assert.equal(sourceCoverageResult("TECHNICAL_SOURCES",1,0,0).outcome,"SEARCHED_UNRESOLVED");
  assert.deepEqual(sourceCoverageResult("TECHNICAL_SOURCES",1,1,0),{
    outcome:"VERIFIED",reason:"Indexed 1 eligible official source(s)."
  });
});
