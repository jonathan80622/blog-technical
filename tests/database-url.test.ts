import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDatabaseUrl } from "../lib/database-url.ts";

test("limits a direct runtime database endpoint to one connection",()=>{
  const url=runtimeDatabaseUrl("postgresql://user:pass@db.prisma.io:5432/postgres?sslmode=require");
  assert.equal(new URL(url!).searchParams.get("connection_limit"),"1");
  assert.equal(new URL(url!).searchParams.get("sslmode"),"require");
});

test("does not rewrite Prisma pooled runtime endpoint",()=>{
  const url="postgresql://user:pass@pooled.db.prisma.io:5432/postgres?sslmode=require";
  assert.equal(runtimeDatabaseUrl(url),url);
});
