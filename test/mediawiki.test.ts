import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../src/http.js";
import { getGameUpdateSections, getRecentChanges, getWikiPage, searchWiki } from "../src/mediawiki.js";

vi.mock("../src/http.js", () => ({
  fetchJson: vi.fn()
}));

const mockedFetchJson = vi.mocked(fetchJson);

describe("MediaWiki client", () => {
  beforeEach(() => {
    mockedFetchJson.mockReset();
  });

  it("searches and strips snippets", async () => {
    mockedFetchJson.mockResolvedValue({
      query: {
        search: [
          {
            title: "Skill",
            pageid: 55,
            snippet: 'A <span class="searchmatch">skill</span> page.',
            wordcount: 10,
            size: 100,
            timestamp: "2026-01-01T00:00:00Z"
          }
        ]
      }
    });

    const results = await searchWiki("gww", "skill", 5);

    expect(results[0]).toMatchObject({
      sourceId: "gww",
      title: "Skill",
      pageId: 55,
      snippet: "A skill page."
    });
  });

  it("fetches a page without editor usernames", async () => {
    mockedFetchJson.mockResolvedValue({
      query: {
        pages: {
          "55": {
            pageid: 55,
            title: "Skill",
            fullurl: "https://wiki.guildwars.com/wiki/Skill",
            extract: "A skill is a player action.",
            categories: [{ title: "Category:Game mechanics" }],
            links: [{ title: "Elite skill" }],
            revisions: [{ revid: 10, parentid: 9, timestamp: "2026-01-01T00:00:00Z", comment: "edit" }]
          }
        }
      }
    });

    const page = await getWikiPage("gww", "Skill", 1000);

    expect(page.revision).toEqual({ id: 10, parentId: 9, timestamp: "2026-01-01T00:00:00Z", comment: "edit" });
    expect(JSON.stringify(page)).not.toContain("user");
  });

  it("reads recent changes without usernames", async () => {
    mockedFetchJson.mockResolvedValue({
      query: {
        recentchanges: [{ title: "Game updates", pageid: 1, revid: 2, old_revid: 1, timestamp: "2026-01-01T00:00:00Z", type: "edit" }]
      }
    });

    const changes = await getRecentChanges("gww", 5);

    expect(changes[0]?.url).toBe("https://wiki.guildwars.com/wiki/Game_updates");
    expect(JSON.stringify(changes)).not.toContain("user");
  });

  it("parses game update sections", async () => {
    mockedFetchJson.mockResolvedValue({
      query: {
        pages: {
          "1690": {
            pageid: 1690,
            title: "Game updates",
            fullurl: "https://wiki.guildwars.com/wiki/Game_updates",
            extract: "Intro\n\n== Update June 25, 2026 ==\nFixed pets.\n\n== Update June 24, 2026 ==\nReleased mobile.\n"
          }
        }
      }
    });

    const updates = await getGameUpdateSections(2);

    expect(updates.map((update) => update.heading)).toEqual(["Update June 25, 2026", "Update June 24, 2026"]);
    expect(updates[0]?.text).toBe("Fixed pets.");
  });

  it("surfaces MediaWiki API errors instead of returning empty results", async () => {
    mockedFetchJson.mockResolvedValue({
      error: { code: "ratelimited", info: "You've exceeded your rate limit." }
    });

    await expect(searchWiki("gww", "skill", 5)).rejects.toThrow("ratelimited");
    await expect(getRecentChanges("gww", 5)).rejects.toThrow("ratelimited");
    await expect(getWikiPage("gww", "Skill", 1000)).rejects.toThrow("ratelimited");
  });

  it("uses a short cache TTL for recent changes", async () => {
    mockedFetchJson.mockResolvedValue({ query: { recentchanges: [] } });

    await getRecentChanges("gww", 5);

    expect(mockedFetchJson).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cacheTtlMs: 60_000 }));
  });
});
