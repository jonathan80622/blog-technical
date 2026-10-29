import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { discoverTestFiles } from "../scripts/test-discovery.mjs";

test("discovers TypeScript test and spec files recursively, without a hardcoded list", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "test-discovery-"));
  try {
    await mkdir(join(fixture, "nested"));
    await Promise.all([
      writeFile(join(fixture, "root.test.ts"), ""),
      writeFile(join(fixture, "nested", "browser.spec.ts"), ""),
      writeFile(join(fixture, "nested", "helper.ts"), ""),
      writeFile(join(fixture, "ignored.test.js"), ""),
    ]);
    const found = await discoverTestFiles(fixture);
    assert.deepEqual(found.map(file => relative(fixture, file)), ["nested/browser.spec.ts", "root.test.ts"]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
