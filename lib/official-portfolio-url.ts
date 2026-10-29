function normalizedOfficialHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/**
 * Allows the official host itself and its subdomains.  `www` is treated as a
 * conventional spelling of the apex, not as a separate registrable domain.
 */
export function portfolioHostMatchesOfficialDomain(portfolioHost: string, officialHost: string): boolean {
  const portfolio = normalizedOfficialHostname(portfolioHost);
  const official = normalizedOfficialHostname(officialHost);
  return Boolean(portfolio && official) && (portfolio === official || portfolio.endsWith(`.${official}`));
}

export function officialHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`${label} is not a URL.`); }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.port && url.port !== "443") throw new Error(`${label} must use the standard HTTPS port.`);
  return url;
}

export function verifiedOfficialPortfolioUrls(officialUrl: string, portfolioUrl: string): { official: URL; portfolio: URL } {
  const official = officialHttpsUrl(officialUrl, "Official URL");
  const portfolio = officialHttpsUrl(portfolioUrl, "Portfolio URL");
  if (!portfolioHostMatchesOfficialDomain(portfolio.hostname, official.hostname)) {
    throw new Error(`Portfolio URL host ${JSON.stringify(portfolio.hostname)} does not match official investor host ${JSON.stringify(official.hostname)}.`);
  }
  return { official, portfolio };
}
