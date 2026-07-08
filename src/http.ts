// Shared HTTP layer: cached, coalesced, retrying fetch with a policy-compliant
// User-Agent. NOTE: mirrored in everquest-legends-mcp/src/http.ts (same core;
// that repo adds postJson/primeTextCache and omits fetchJson) — port fixes to both.
import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_ACCEPT = "text/html,application/json,application/atom+xml;q=0.9,*/*;q=0.8";
const MAX_CACHE_ENTRIES = 256;
const RETRY_DELAY_MS = 300;
// 429 is deliberately absent: retrying a rate limiter after 300ms adds pressure
// exactly when the host asks for less. Client timeouts (AbortError) are not
// retried either — a host that ate the whole budget rarely answers a retry.
const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

export const PACKAGE_VERSION = packageJson.version;

// Descriptive User-Agent following the MediaWiki/Wikimedia User-Agent policy
// (https://meta.wikimedia.org/wiki/User-Agent_policy): "<client>/<version> (<contact>)".
// The Guild Wars Wiki rejects bare tool-name User-Agents with HTTP 403, so we
// identify the client and provide a contact URL for the maintainers.
export const USER_AGENT = `guildwars1-mcp/${PACKAGE_VERSION} (+https://github.com/ArtSabintsev/guildwars1-mcp)`;

type CacheEntry = {
  fetchedAt: number;
  body: string;
};

// Entries record when they were fetched; freshness is judged against each
// caller's TTL so a long-TTL caller can never pin stale data on a short-TTL one.
const textCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<string>>();

export type FetchTextOptions = {
  timeoutMs?: number;
  cacheTtlMs?: number;
  accept?: string;
  /**
   * Called with the response body before it enters the cache; return false to
   * serve the body without caching it. Lets API clients keep transient
   * in-band errors (MediaWiki returns them with HTTP 200) out of the cache.
   */
  cacheable?: (body: string) => boolean;
};

type RequestSpec = {
  method: "GET" | "POST";
  url: string;
  accept: string;
  body?: string;
  extraHeaders?: Record<string, string>;
};

function cacheKey(spec: RequestSpec): string {
  // Headers participate in the key so responses fetched under one credential
  // are never served to a caller using another.
  const headersKey = spec.extraHeaders ? JSON.stringify(Object.entries(spec.extraHeaders).sort()) : "";
  return `${spec.method} ${spec.url}\n${spec.accept}\n${spec.body ?? ""}\n${headersKey}`;
}

function isRetryableError(error: unknown): boolean {
  // Undici surfaces network-level failures (DNS, reset, refused) as TypeError.
  if (!(error instanceof TypeError)) return false;
  // Certificate failures are deterministic; retrying just doubles the pain.
  const code = (error as { cause?: { code?: string } }).cause?.code ?? "";
  return !/CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code);
}

async function requestOnce(spec: RequestSpec, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(spec.url, {
      method: spec.method,
      signal: controller.signal,
      headers: {
        "accept": spec.accept,
        "user-agent": USER_AGENT,
        ...(spec.extraHeaders ?? {})
      },
      ...(spec.body !== undefined ? { body: spec.body } : {})
    });
    if (!response.ok) {
      const error = new Error(`${spec.method} ${spec.url} failed with HTTP ${response.status}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetry(spec: RequestSpec, timeoutMs: number): Promise<string> {
  try {
    return await requestOnce(spec, timeoutMs);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const retryable = status !== undefined ? RETRYABLE_STATUSES.has(status) : isRetryableError(error);
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return requestOnce(spec, timeoutMs);
  }
}

function storeInCache(key: string, body: string): void {
  // Refreshing an existing key must not evict a bystander, and re-setting the
  // key moves it to the back of the (insertion-ordered) eviction queue.
  if (!textCache.has(key) && textCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = textCache.keys().next().value;
    if (oldest !== undefined) textCache.delete(oldest);
  }
  textCache.delete(key);
  textCache.set(key, { body, fetchedAt: Date.now() });
}

async function cachedRequest(spec: RequestSpec, options: FetchTextOptions): Promise<string> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const key = cacheKey(spec);

  const cached = textCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.body;
  }

  // Coalesce concurrent identical requests into one upstream call.
  const pending = pendingFetches.get(key);
  if (pending) {
    return pending;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = requestWithRetry(spec, timeoutMs)
    .then((body) => {
      if (cacheTtlMs > 0 && (options.cacheable?.(body) ?? true)) {
        storeInCache(key, body);
      }
      return body;
    })
    .finally(() => {
      pendingFetches.delete(key);
    });
  pendingFetches.set(key, request);
  return request;
}

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  return cachedRequest({ method: "GET", url, accept: options.accept ?? DEFAULT_ACCEPT }, options);
}

export async function fetchJson<T>(url: string, options: FetchTextOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    accept: options.accept ?? "application/json,text/plain;q=0.9,*/*;q=0.8"
  });
  return JSON.parse(text) as T;
}

export function clearFetchCache(): void {
  textCache.clear();
  pendingFetches.clear();
}
