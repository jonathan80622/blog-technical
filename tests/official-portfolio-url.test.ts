import assert from "node:assert/strict";
import test from "node:test";
import { portfolioHostMatchesOfficialDomain, verifiedOfficialPortfolioUrls } from "../lib/official-portfolio-url.ts";

test("accepts equivalent apex and www official portfolio hosts", () => {
  for (const [official, portfolio] of [
    ["https://www.thrivecap.com", "https://thrivecap.com/portfolio"],
    ["https://thrivecap.com", "https://www.thrivecap.com/portfolio"],
  ]) {
    assert.equal(verifiedOfficialPortfolioUrls(official, portfolio).portfolio.hostname.endsWith("thrivecap.com"), true);
  }
});

test("accepts a portfolio subdomain but rejects a lookalike or unrelated host with actionable diagnostics", () => {
  assert.equal(portfolioHostMatchesOfficialDomain("portfolio.example.com", "example.com"), true);
  assert.equal(portfolioHostMatchesOfficialDomain("example.com.evil.test", "example.com"), false);
  assert.throws(
    () => verifiedOfficialPortfolioUrls("https://www.example.com", "https://portfolio.example.net/companies"),
    /Portfolio URL host "portfolio\.example\.net" does not match official investor host "www\.example\.com"/,
  );
});

test("rejects unsafe or nonstandard official-discovery URLs before they are fetched", () => {
  assert.throws(() => verifiedOfficialPortfolioUrls("http://example.com", "https://example.com/portfolio"), /Official URL must use HTTPS/);
  assert.throws(() => verifiedOfficialPortfolioUrls("https://u:p@example.com", "https://example.com/portfolio"), /Official URL must not contain credentials/);
  assert.throws(() => verifiedOfficialPortfolioUrls("https://example.com", "https://example.com:8443/portfolio"), /Portfolio URL must use the standard HTTPS port/);
});
