import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../src/http.js";
import { getYouTubeVideos, listYouTubeSources, parseYouTubeFeed } from "../src/youtube.js";

vi.mock("../src/http.js", () => ({
  fetchText: vi.fn()
}));

const mockedFetchText = vi.mocked(fetchText);

describe("YouTube feeds", () => {
  beforeEach(() => {
    mockedFetchText.mockReset();
  });

  it("lists official and creator sources", () => {
    expect(listYouTubeSources("official").map((source) => source.id)).toEqual(["official-guild-wars-youtube"]);
    expect(listYouTubeSources("creators").length).toBeGreaterThan(3);
  });

  it("parses YouTube Atom feed entries", () => {
    const videos = parseYouTubeFeed(`
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <entry>
          <yt:videoId>-dd5z9A9oc4</yt:videoId>
          <title>End of The Old Meta? Skill Balance Update 2026 June [Guild Wars Reforged]</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=-dd5z9A9oc4" />
          <author><name>Peter Kadar</name></author>
          <published>2026-06-20T12:00:00+00:00</published>
          <updated>2026-06-20T12:00:00+00:00</updated>
          <media:group><media:thumbnail url="https://i.ytimg.com/vi/-dd5z9A9oc4/hqdefault.jpg" /></media:group>
        </entry>
      </feed>
    `);

    expect(videos).toEqual([
      {
        videoId: "-dd5z9A9oc4",
        title: "End of The Old Meta? Skill Balance Update 2026 June [Guild Wars Reforged]",
        url: "https://www.youtube.com/watch?v=-dd5z9A9oc4",
        publishedAt: "2026-06-20T12:00:00+00:00",
        updatedAt: "2026-06-20T12:00:00+00:00",
        channelTitle: "Peter Kadar",
        thumbnailUrl: "https://i.ytimg.com/vi/-dd5z9A9oc4/hqdefault.jpg"
      }
    ]);
  });

  it("filters selected feeds and adds source attribution", async () => {
    mockedFetchText.mockResolvedValue(`
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry>
          <yt:videoId>guild-wars</yt:videoId>
          <title>Guild Wars Reforged Mesmer Build</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=guild-wars" />
          <published>2026-06-20T12:00:00+00:00</published>
        </entry>
        <entry>
          <yt:videoId>other</yt:videoId>
          <title>Unrelated Video</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=other" />
          <published>2026-06-19T12:00:00+00:00</published>
        </entry>
      </feed>
    `);

    const search = await getYouTubeVideos({ sourceIds: ["peter-kadar-youtube"], query: "Mesmer", limitPerSource: 5 });

    expect(search.videos).toHaveLength(1);
    expect(search.videos[0]?.sourceId).toBe("peter-kadar-youtube");
    expect(search.videos[0]?.sourceAuthority).toBe("creator");
  });

  it("reports unknown source ids", async () => {
    const search = await getYouTubeVideos({ sourceIds: ["missing"] });

    expect(search.videos).toEqual([]);
    expect(search.failedSources[0]?.reason).toBe("Unknown YouTube source id.");
    expect(mockedFetchText).not.toHaveBeenCalled();
  });
});
