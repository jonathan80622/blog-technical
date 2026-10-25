import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicSource, hostnameMatchesDomain, resolvePublicAddress } from "../lib/safe-source-fetch.ts";

test("Given a verified root domain, Then only that host and its subdomains match", () => {
  assert.equal(hostnameMatchesDomain("www.amplifypartners.com", "amplifypartners.com"), true);
  assert.equal(hostnameMatchesDomain("amplifypartners.com.evil.example", "amplifypartners.com"), false);
  assert.equal(hostnameMatchesDomain("evilamplifypartners.com", "amplifypartners.com"), false);
});

test("Given a public hostname, When it resolves, Then the request uses a pinned public address", async () => {
  let requestedAddress = "";
  const response = await fetchPublicSource("https://acme.example/blog", {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (_url, address) => {
      requestedAddress = address.address;
      return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("public article") };
    },
  });

  assert.equal(response.ok, true);
  assert.equal(await response.text(), "public article");
  assert.equal(requestedAddress, "93.184.216.34");
});

test("Given a local, literal, or nonstandard-port URL, Then no network lookup is attempted", async () => {
  let lookups = 0;
  const resolve = async () => { lookups++; return [{ address: "93.184.216.34", family: 4 }]; };
  for (const url of [
    "https://127.0.0.1/admin", "https://[::1]/admin", "https://metadata.google.internal/",
    "https://service.local/", "https://acme.example:8443/",
  ]) await assert.rejects(fetchPublicSource(url, { resolve }), /public DNS hostname|standard HTTPS port/);
  assert.equal(lookups, 0);
});

test("Given public and private DNS answers, Then the hostname is rejected", async () => {
  await assert.rejects(
    resolvePublicAddress("mixed.example", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]),
    /only to public IP addresses/,
  );
  await assert.rejects(
    resolvePublicAddress("v6-local.example", async () => [{ address: "fd00::1", family: 6 }]),
    /only to public IP addresses/,
  );
});

test("Given a redirect outside the verified domain, Then the destination is never requested", async () => {
  const requested: string[] = [];
  await assert.rejects(fetchPublicSource("https://acme.example/blog", {
    allowedDomain: "acme.example",
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async url => {
      requested.push(url.hostname);
      return { status: 302, headers: { location: "https://other.example/collect" }, body: Buffer.alloc(0) };
    },
  }), /verified source domain/);
  assert.deepEqual(requested, ["acme.example"]);
});

test("Given a redirect that resolves to a private address, Then it is rejected before request", async () => {
  const requested: string[] = [];
  await assert.rejects(fetchPublicSource("https://acme.example/blog", {
    resolve: async hostname => [{ address: hostname === "internal.acme.example" ? "169.254.169.254" : "93.184.216.34", family: 4 }],
    request: async url => {
      requested.push(url.hostname);
      return { status: 302, headers: { location: "https://internal.acme.example/latest/meta-data" }, body: Buffer.alloc(0) };
    },
  }), /only to public IP addresses/);
  assert.deepEqual(requested, ["acme.example"]);
});
