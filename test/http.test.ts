import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFetchCache, fetchText, USER_AGENT } from "../src/http.js";

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("fetchText", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearFetchCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves repeat requests from cache within the caller's TTL", async () => {
    fetchMock.mockResolvedValue(okResponse("body"));

    await fetchText("https://example.test/a");
    const second = await fetchText("https://example.test/a");

    expect(second).toBe("body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("judges freshness against each caller's TTL, not the first caller's", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("first")).mockResolvedValueOnce(okResponse("second"));

    // First caller caches with the long default TTL...
    await fetchText("https://example.test/a");
    // ...a zero-TTL caller must still get a live fetch, not the pinned entry.
    const fresh = await fetchText("https://example.test/a", { cacheTtlMs: 0 });

    expect(fresh).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by accept header as well as URL", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("html")).mockResolvedValueOnce(okResponse("json"));

    const html = await fetchText("https://example.test/a", { accept: "text/html" });
    const json = await fetchText("https://example.test/a", { accept: "application/json" });

    expect(html).toBe("html");
    expect(json).toBe("json");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical requests into one upstream fetch", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const first = fetchText("https://example.test/a");
    const second = fetchText("https://example.test/a");
    release(okResponse("shared"));

    expect(await first).toBe("shared");
    expect(await second).toBe("shared");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a retryable HTTP status", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(okResponse("recovered"));

    const body = await fetchText("https://example.test/a");

    expect(body).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable HTTP errors and does not cache them", async () => {
    fetchMock.mockResolvedValueOnce(new Response("missing", { status: 404 })).mockResolvedValueOnce(okResponse("later"));

    await expect(fetchText("https://example.test/a")).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = await fetchText("https://example.test/a");
    expect(body).toBe("later");
  });

  it("sends the policy-compliant User-Agent", async () => {
    fetchMock.mockResolvedValue(okResponse("body"));

    await fetchText("https://example.test/a");

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^guildwars1-mcp\/\d+\.\d+\.\d+ \(\+https:/);
  });
});
