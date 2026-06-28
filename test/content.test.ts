import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchGw1Builds } from "../src/gw1builds.js";
import { searchWiki } from "../src/mediawiki.js";
import { searchGuildWarsSubreddit } from "../src/reddit.js";
import { getYouTubeVideos } from "../src/youtube.js";
import { searchContent } from "../src/content.js";

vi.mock("../src/gw1builds.js", () => ({ searchGw1Builds: vi.fn() }));
vi.mock("../src/mediawiki.js", () => ({ searchWiki: vi.fn() }));
vi.mock("../src/reddit.js", () => ({ searchGuildWarsSubreddit: vi.fn() }));
vi.mock("../src/youtube.js", () => ({ getYouTubeVideos: vi.fn() }));

describe("content search", () => {
  beforeEach(() => {
    vi.mocked(searchGw1Builds).mockReset();
    vi.mocked(searchWiki).mockReset();
    vi.mocked(searchGuildWarsSubreddit).mockReset();
    vi.mocked(getYouTubeVideos).mockReset();
  });

  it("normalizes results across selected sources", async () => {
    vi.mocked(searchWiki).mockResolvedValue([{ sourceId: "gww", sourceTitle: "Guild Wars Wiki", title: "Mesmer", pageId: 1, snippet: "Class page", url: "https://wiki.guildwars.com/wiki/Mesmer" }]);
    vi.mocked(searchGw1Builds).mockResolvedValue({ query: "Mesmer", pagesFetched: 1, nextOffset: null, results: [{ sourceId: "gw1builds", id: "b1", name: "Mesmer Build", url: "https://gw1builds.com/b/b1", tags: ["mesmer"], bars: [] }] });
    vi.mocked(getYouTubeVideos).mockResolvedValue({ query: "Mesmer", sources: [], failedSources: [], videos: [{ sourceId: "yt", sourceTitle: "Creator", sourceAuthority: "creator", videoId: "v1", title: "Mesmer Video", url: "https://youtube.com/watch?v=v1", publishedAt: "2026-06-20T12:00:00Z" }] });
    vi.mocked(searchGuildWarsSubreddit).mockResolvedValue({ subreddit: "GuildWars", query: "Mesmer", url: "https://reddit.com", results: [{ title: "Mesmer thread", url: "https://reddit.com/r/GuildWars", summary: "Discussion" }] });

    const search = await searchContent({ query: "Mesmer", sources: ["wiki", "gw1builds", "youtube", "reddit"], limitPerSource: 2 });

    expect(search.results.map((result) => result.kind)).toEqual(expect.arrayContaining(["wiki-page", "build", "video", "discussion"]));
    expect(search.failedSources).toEqual([]);
  });
});
