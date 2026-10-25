import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";

const maxBodyBytes = 8 * 1024 * 1024;
const maxRedirects = 5;

const blockedAddresses = new BlockList();
for (const range of [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
]) blockedAddresses.addSubnet(range.split("/")[0], Number(range.split("/")[1]), "ipv4");
for (const range of [
  "::/128", "::1/128", "64:ff9b:1::/48", "100::/64",
  "2001::/23", "2001:20::/28", "2001:db8::/32", "2002::/16", "3fff::/20",
  "fc00::/7", "fe80::/10", "ff00::/8",
]) blockedAddresses.addSubnet(range.split("/")[0], Number(range.split("/")[1]), "ipv6");

export type ResolvedAddress = { address: string; family: number };
export type SourceResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
type ResponseData = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
type PublicSourceFetchOptions = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (url: URL, address: ResolvedAddress) => Promise<ResponseData>;
  allowedDomain?: string;
};

const systemResolve = async (hostname: string): Promise<ResolvedAddress[]> => lookup(hostname, { all: true, verbatim: true });

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family !== 6) return false;
  // Public IPv6 unicast currently lives in 2000::/3. Excluding special purpose
  // ranges above prevents transition, documentation, and local addresses too.
  const firstHextet = Number.parseInt(address.split(":")[0] || "0", 16);
  return (firstHextet & 0xe000) === 0x2000 && !blockedAddresses.check(address, "ipv6");
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHostname(hostname);
  const root = normalizeHostname(domain);
  return host === root || host.endsWith(`.${root}`);
}

function validateUrl(url: URL, allowedDomain?: string): void {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Source URL must use HTTPS and contain no credentials.");
  }
  if (url.port && url.port !== "443") throw new Error("Source URL must use the standard HTTPS port.");
  const hostname = normalizeHostname(url.hostname);
  if (!hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Source URL must use a public DNS hostname.");
  }
  if (isIP(hostname)) throw new Error("Source URL must use a public DNS hostname.");
  if (allowedDomain && !hostnameMatchesDomain(hostname, allowedDomain)) {
    throw new Error("Source redirect left the verified source domain.");
  }
}

export async function resolvePublicAddress(hostname: string, resolve = systemResolve): Promise<ResolvedAddress> {
  const normalized = normalizeHostname(hostname);
  if (!normalized.includes(".") || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal") || isIP(normalized)) {
    throw new Error("Source URL must use a public DNS hostname.");
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(normalized);
  } catch {
    throw new Error("Source hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Source hostname must resolve only to public IP addresses.");
  }
  const selected = addresses[0];
  if (selected.family !== isIP(selected.address)) throw new Error("Source hostname resolved to an invalid IP address.");
  return selected;
}

function requestPinned(url: URL, address: ResolvedAddress): Promise<ResponseData> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family?: number) => void) => {
      callback(null, address.address, address.family);
    }) as never;
    const request = httpsRequest(url, {
      headers: {
        "User-Agent": "Startup-AI-evidence research (+human-reviewed)",
        "Accept-Encoding": "identity",
      },
      lookup: pinnedLookup,
    }, response => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBodyBytes) {
          request.destroy(new Error("Source response exceeded the 8 MB limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 502,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on("error", reject);
    });
    request.setTimeout(25_000, () => request.destroy(new Error("Source request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

function header(headers: ResponseData["headers"], name: string): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value ?? null;
}

/** Fetches public HTTPS sources with DNS pinning and redirect validation. */
export async function fetchPublicSource(input: string, options: PublicSourceFetchOptions = {}): Promise<SourceResponse> {
  const resolve = options.resolve ?? systemResolve;
  const requestOnce = options.request ?? requestPinned;
  let current: URL;
  try { current = new URL(input); }
  catch { throw new Error("Invalid source URL."); }
  const allowedDomain = options.allowedDomain ?? current.hostname;

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    validateUrl(current, allowedDomain);
    const address = await resolvePublicAddress(current.hostname, resolve);
    const result = await requestOnce(current, address);
    const location = header(result.headers, "location");
    if ([301, 302, 303, 307, 308].includes(result.status) && location) {
      if (redirects === maxRedirects) throw new Error("Source exceeded the redirect limit.");
      let next: URL;
      try { next = new URL(location, current); }
      catch { throw new Error("Source returned an invalid redirect URL."); }
      validateUrl(next, allowedDomain);
      current = next;
      continue;
    }
    const encoding = header(result.headers, "content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("Source returned an unsupported compressed response.");
    const text = result.body.toString("utf8");
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: name => header(result.headers, name.toLowerCase()) },
      text: async () => text,
    };
  }
  throw new Error("Source exceeded the redirect limit.");
}
