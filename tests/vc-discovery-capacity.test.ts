import assert from "node:assert/strict";
import test from "node:test";
import { vcDiscoveryActiveLimit } from "../lib/vc-discovery-capacity.ts";

test("permits five active VC workflows only through Prisma's pooled runtime endpoint",()=>{
  assert.equal(vcDiscoveryActiveLimit("postgresql://user:pass@pooled.db.prisma.io:5432/postgres",undefined),5);
  assert.equal(vcDiscoveryActiveLimit("postgresql://user:pass@db.prisma.io:5432/postgres",undefined),1);
  assert.equal(vcDiscoveryActiveLimit(undefined,undefined),1);
});

test("keeps an explicit capacity bounded at five",()=>{
  assert.equal(vcDiscoveryActiveLimit("postgresql://user:pass@db.prisma.io:5432/postgres","3"),1);
  assert.equal(vcDiscoveryActiveLimit("postgresql://user:pass@pooled.db.prisma.io:5432/postgres","99"),5);
});
