const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

// Descriptive User-Agent following the MediaWiki/Wikimedia User-Agent policy
// (https://meta.wikimedia.org/wiki/User-Agent_policy): "<client>/<version> (<contact>)".
// The Guild Wars Wiki rejects bare tool-name User-Agents with HTTP 403, so we
// identify the client and provide a contact URL for the maintainers.
const USER_AGENT = "guildwars1-mcp/0.3.0 (+https://github.com/ArtSabintsev/guildwars1-mcp)";

type CacheEntry = {
  expiresAt: number;
  body: string;
};

const textCache = new Map<string, CacheEntry>();

export type FetchTextOptions = {
  timeoutMs?: number;
  cacheTtlMs?: number;
  accept?: string;
};

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cached = textCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.body;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: options.accept ?? "text/html,application/json,application/atom+xml;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }

    const body = await response.text();
    if (cacheTtlMs > 0) {
      textCache.set(url, {
        body,
        expiresAt: Date.now() + cacheTtlMs
      });
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
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
}
