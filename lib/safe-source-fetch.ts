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
export type FetchAttempt = {
  attempt: number;
  finalUrl: string;
  outcome: string;
  status?: number;
  error?: string;
  requests: Array<{ url: string; status?: number }>;
};
export type FetchOutcome = "success" | "permanent_http" | "http_error" | "retry_exhausted" | "inaccessible" | "policy_rejected" | "redirect_error";
export type SourceResponse = {
  ok: boolean;
  status: number;
  finalUrl: string;
  attemptCount: number;
  attempts: FetchAttempt[];
  outcome: FetchOutcome;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
type ResponseData = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
type PublicSourceFetchOptions = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (url: URL, address: ResolvedAddress) => Promise<ResponseData>;
  allowedDomain?: string;
  maxAttempts?: number;
};

export class SourceFetchError extends Error {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly attemptCount: number;
  readonly attempts: FetchAttempt[];
  readonly outcome: FetchOutcome;
  readonly status?: number;

  constructor(message: string, details: {
    requestedUrl: string;
    finalUrl: string;
    attempts: FetchAttempt[];
    outcome: FetchOutcome;
    status?: number;
  }) {
    super(message);
    this.name = "SourceFetchError";
    this.requestedUrl = details.requestedUrl;
    this.finalUrl = details.finalUrl;
    this.attempts = details.attempts;
    this.attemptCount = details.attempts.length;
    this.outcome = details.outcome;
    this.status = details.status;
  }
}

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
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
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
  } catch (error) {
    throw Object.assign(new Error("Source hostname could not be resolved."), { cause: error });
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
    request.setTimeout(25_000, () => {
      const error = Object.assign(new Error("Source request timed out."), { code: "ETIMEDOUT" });
      request.destroy(error);
    });
    request.on("error", reject);
    request.end();
  });
}

function header(headers: ResponseData["headers"], name: string): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value ?? null;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === "string") return value.code;
  return errorCode(value.cause);
}

function isTransientNetworkError(error: unknown): boolean {
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"].includes(errorCode(error) ?? "");
}

function isPolicyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("must use HTTPS") || message.includes("standard HTTPS port") || message.includes("public DNS") || message.includes("verified source domain") || message.includes("redirect URL") || message.includes("redirect limit");
}

function responseFor(result: ResponseData, requestedUrl: string, finalUrl: string, attempts: FetchAttempt[]): SourceResponse {
  const encoding = header(result.headers, "content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new SourceFetchError("Source returned an unsupported compressed response.", {
      requestedUrl, finalUrl, attempts, outcome: "inaccessible", status: result.status,
    });
  }
  const text = result.body.toString("utf8");
  const outcome: FetchOutcome = result.status >= 200 && result.status < 300
    ? "success"
    : result.status >= 400 && result.status < 500
      ? "permanent_http"
      : "http_error";
  return {
    ok: outcome === "success",
    status: result.status,
    finalUrl,
    attemptCount: attempts.length,
    attempts,
    outcome,
    headers: { get: name => header(result.headers, name.toLowerCase()) },
    text: async () => text,
  };
}

/** Fetches public HTTPS sources with DNS pinning, verified-domain redirect validation, and bounded retries. */
export async function fetchPublicSource(input: string, options: PublicSourceFetchOptions = {}): Promise<SourceResponse> {
  const resolve = options.resolve ?? systemResolve;
  const requestOnce = options.request ?? requestPinned;
  const maxAttempts = options.maxAttempts ?? 1;
  let requested: URL;
  try { requested = new URL(input); }
  catch { throw new SourceFetchError("Invalid source URL.", { requestedUrl: input, finalUrl: input, attempts: [], outcome: "policy_rejected" }); }
  const requestedUrl = input;
  const allowedDomain = options.allowedDomain ?? requested.hostname;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new SourceFetchError("Source fetch requires at least one configured attempt.", { requestedUrl, finalUrl: requestedUrl, attempts: [], outcome: "policy_rejected" });
  }
  let lastFinalUrl = requestedUrl;
  const attempts: FetchAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let current = new URL(input);
    const requests: FetchAttempt["requests"] = [];
    try {
      let result: ResponseData | undefined;
      for (let redirects = 0; redirects <= maxRedirects; redirects++) {
        lastFinalUrl = current.toString();
        validateUrl(current, allowedDomain);
        const address = await resolvePublicAddress(current.hostname, resolve);
        result = await requestOnce(current, address);
        requests.push({ url: current.toString(), status: result.status });
        const location = header(result.headers, "location");
        if ([301, 302, 303, 307, 308].includes(result.status) && location) {
          if (redirects === maxRedirects) {
            throw new SourceFetchError("Source exceeded the redirect limit.", {
              requestedUrl, finalUrl: current.toString(), attempts: [...attempts, { attempt, finalUrl: current.toString(), outcome: "redirect_error", status: result.status, requests }], outcome: "redirect_error", status: result.status,
            });
          }
          let next: URL;
          try { next = new URL(location, current); }
          catch { throw new SourceFetchError("Source returned an invalid redirect URL.", {
            requestedUrl, finalUrl: current.toString(), attempts: [...attempts, { attempt, finalUrl: current.toString(), outcome: "redirect_error", status: result.status, requests }], outcome: "redirect_error", status: result.status,
          }); }
          validateUrl(next, allowedDomain);
          current = next;
          continue;
        }
        break;
      }
      if (!result) throw new Error("Source returned no response.");
      lastFinalUrl = current.toString();
      const retryableStatus = result.status === 408 || result.status === 429 || (result.status >= 500 && result.status <= 599);
      if (retryableStatus) {
        const outcome = result.status === 408 ? "timeout" : "retryable_http";
        const entry: FetchAttempt = { attempt, finalUrl: lastFinalUrl, outcome, status: result.status, requests };
        attempts.push(entry);
        if (attempt < maxAttempts) continue;
        throw new SourceFetchError(`Source fetch exhausted ${maxAttempts} attempts after HTTP ${result.status}.`, {
          requestedUrl, finalUrl: lastFinalUrl, attempts, outcome: "retry_exhausted", status: result.status,
        });
      }
      const finalOutcome = result.status >= 200 && result.status < 300 ? "success" : result.status >= 400 && result.status < 500 ? "permanent_http" : "http_error";
      attempts.push({ attempt, finalUrl: lastFinalUrl, outcome: finalOutcome, status: result.status, requests });
      return responseFor(result, requestedUrl, lastFinalUrl, attempts);
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      const message = error instanceof Error ? error.message : "Unknown source fetch failure.";
      const transient = isTransientNetworkError(error);
      const outcome = transient ? (errorCode(error) === "ETIMEDOUT" || errorCode(error) === "ESOCKETTIMEDOUT" ? "timeout" : "network_error") : isPolicyError(error) ? "policy_rejected" : "inaccessible";
      attempts.push({ attempt, finalUrl: lastFinalUrl, outcome, error: message, requests });
      if (transient && attempt < maxAttempts) continue;
      throw new SourceFetchError(transient ? `Source fetch exhausted ${maxAttempts} attempts: ${message}` : message, {
        requestedUrl, finalUrl: lastFinalUrl, attempts, outcome: transient ? "retry_exhausted" : outcome,
      });
    }
  }
  throw new SourceFetchError("Source fetch exhausted its configured attempt budget.", { requestedUrl, finalUrl: lastFinalUrl, attempts, outcome: "retry_exhausted" });
}
