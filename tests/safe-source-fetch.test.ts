import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicSource, hostnameMatchesDomain, resolvePublicAddress, SourceFetchError } from "../lib/safe-source-fetch.ts";

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

const publicResolve = async () => [{ address: "93.184.216.34", family: 4 }];
const requestedUrl = "https://acme.example/blog/original";
const finalUrl = "https://acme.example/blog/final";

test("Redirected fetch records the final URL and counts each direct attempt once", async () => {
  const requested: string[] = [];
  const response = await fetchPublicSource(requestedUrl, {
    maxAttempts: 3,
    resolve: publicResolve,
    request: async url => {
      requested.push(url.toString());
      return url.toString() === requestedUrl
        ? { status: 302, headers: { location: finalUrl }, body: Buffer.alloc(0) }
        : { status: 200, headers: {}, body: Buffer.from("Fetched article") };
    },
  });
  assert.deepEqual(requested, [requestedUrl, finalUrl]);
  assert.equal(response.finalUrl, finalUrl);
  assert.equal(response.attemptCount, 1);
  assert.deepEqual(response.attempts.map(a => a.requests), [[
    { url: requestedUrl, status: 302 }, { url: finalUrl, status: 200 },
  ]]);
});

test("Transient network, timeout, 429, and 5xx failures retry within the configured bound", async () => {
  for (const failure of ["ECONNRESET", "ETIMEDOUT", 408, 429, 503] as const) {
    let calls = 0;
    const response = await fetchPublicSource(requestedUrl, {
      maxAttempts: 2,
      resolve: publicResolve,
      request: async () => {
        calls++;
        if (calls === 1) {
          if (typeof failure === "string") throw Object.assign(new Error(failure), { code: failure });
          return { status: failure, headers: {}, body: Buffer.alloc(0) };
        }
        return { status: 200, headers: {}, body: Buffer.from("Fetched article") };
      },
    });
    assert.equal(calls, 2, String(failure));
    assert.equal(response.attemptCount, 2, String(failure));
    assert.deepEqual(response.attempts.map(a => a.attempt), [1, 2]);
    assert.equal(response.outcome, "success");
  }
});

test("Permanent 4xx stops after one attempt and never verifies the source", async () => {
  let calls = 0;
  const response = await fetchPublicSource(requestedUrl, {
    maxAttempts: 3,
    resolve: publicResolve,
    request: async () => { calls++; return { status: 404, headers: {}, body: Buffer.alloc(0) }; },
  });
  assert.equal(calls, 1);
  assert.equal(response.attemptCount, 1);
  assert.equal(response.ok, false);
  assert.equal(response.outcome, "permanent_http");
});

test("Exhausted redirects retain requested and final URLs and the exact attempt count", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicSource(requestedUrl, {
    maxAttempts: 2,
    resolve: publicResolve,
    request: async url => {
      calls++;
      return url.toString() === requestedUrl
        ? { status: 302, headers: { location: finalUrl }, body: Buffer.alloc(0) }
        : { status: 503, headers: {}, body: Buffer.alloc(0) };
    },
  }), error => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.requestedUrl, requestedUrl);
    assert.equal(error.finalUrl, finalUrl);
    assert.equal(error.attemptCount, 2);
    assert.equal(error.outcome, "retry_exhausted");
    assert.deepEqual(error.attempts.map(a => a.requests.map(r => r.url)), [
      [requestedUrl, finalUrl], [requestedUrl, finalUrl],
    ]);
    return true;
  });
  assert.equal(calls, 4);
});
