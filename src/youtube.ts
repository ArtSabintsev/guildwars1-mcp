import * as cheerio from "cheerio";
import { fetchText } from "./http.js";

export type YouTubeSourceAuthority = "official" | "creator" | "community";

export type YouTubeSource = {
  id: string;
  title: string;
  handle: string;
  channelId: string;
  url: string;
  feedUrl: string;
  authority: YouTubeSourceAuthority;
  topics: string[];
  notes?: string[];
};

export type YouTubeVideo = {
  sourceId: string;
  sourceTitle: string;
  sourceAuthority: YouTubeSourceAuthority;
  videoId: string;
  title: string;
  url: string;
  publishedAt?: string;
  updatedAt?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
};

export type YouTubeVideoSearchOptions = {
  query?: string;
  scope?: "official" | "creators" | "all";
  sourceIds?: string[];
  limitPerSource?: number;
  maxTotal?: number;
};

export type YouTubeVideoSearch = {
  query?: string;
  sources: YouTubeSource[];
  videos: YouTubeVideo[];
  failedSources: Array<{
    id: string;
    title: string;
    url: string;
    reason: string;
  }>;
};

const GUILD_WARS_TERMS = ["guild wars", "gw1", "reforged", "prophecies", "factions", "nightfall", "eye of the north"];

export const YOUTUBE_SOURCES: YouTubeSource[] = [
  {
    id: "official-guild-wars-youtube",
    title: "Guild Wars",
    handle: "@guildwars2",
    channelId: "UCP_FgMqOxp_VsM0UfrL-DxA",
    url: "https://www.youtube.com/@guildwars2",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP_FgMqOxp_VsM0UfrL-DxA",
    authority: "official",
    topics: ["official", "reforged", "livestreams", "trailers"],
    notes: ["Official ArenaNet channel currently shared with Guild Wars 2 video content."]
  },
  {
    id: "peter-kadar-youtube",
    title: "Peter Kadar",
    handle: "@GW1videos",
    channelId: "UCZmEI7OfVixQ-mtLTzTIkdw",
    url: "https://www.youtube.com/@GW1videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCZmEI7OfVixQ-mtLTzTIkdw",
    authority: "creator",
    topics: ["builds", "skills", "farming", "reforged", "guides"]
  },
  {
    id: "gwreborn-youtube",
    title: "GWReborn",
    handle: "@GWReborn",
    channelId: "UC8YrkQO8RC2yvUHU7SPwCcg",
    url: "https://www.youtube.com/@GWReborn",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC8YrkQO8RC2yvUHU7SPwCcg",
    authority: "creator",
    topics: ["builds", "skills", "pve", "guides"]
  },
  {
    id: "kyosika-youtube",
    title: "Kyosika",
    handle: "@Kyosika",
    channelId: "UCdg2omrlUUYx_tnyIgNiJSg",
    url: "https://www.youtube.com/@Kyosika",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCdg2omrlUUYx_tnyIgNiJSg",
    authority: "creator",
    topics: ["reforged", "professions", "news", "guides"]
  },
  {
    id: "silhouette-gaming-youtube",
    title: "Silhouette Gaming",
    handle: "@SilhouetteGaming1",
    channelId: "UCuotptrvkwteTVqayGHlqHA",
    url: "https://www.youtube.com/@SilhouetteGaming1",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCuotptrvkwteTVqayGHlqHA",
    authority: "creator",
    topics: ["reforged", "beginner", "returning-player", "guides"]
  },
  {
    id: "1nterrupt-youtube",
    title: "1nterrupt",
    handle: "@1nterrupt740",
    channelId: "UC4gophVsTsJD84uw4pSYS4w",
    url: "https://www.youtube.com/@1nterrupt740",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC4gophVsTsJD84uw4pSYS4w",
    authority: "creator",
    topics: ["reforged", "team-builds", "skills"]
  },
  {
    id: "doombox-youtube",
    title: "Doom Box",
    handle: "@DoomBox",
    channelId: "UCvZCL3QV71GslalR596jqGA",
    url: "https://www.youtube.com/@DoomBox",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvZCL3QV71GslalR596jqGA",
    authority: "creator",
    topics: ["reforged", "campaigns", "reviews", "guides"]
  },
  {
    id: "iced-coffee-gaming-youtube",
    title: "Iced Coffee Gaming",
    handle: "@IcedCoffeeGaming",
    channelId: "UCr3Ce5jZKgo8-vP3-KJmUVg",
    url: "https://www.youtube.com/@IcedCoffeeGaming",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCr3Ce5jZKgo8-vP3-KJmUVg",
    authority: "creator",
    topics: ["skills", "balance", "builds", "reforged"]
  },
  {
    id: "renfail-youtube",
    title: "Renfail",
    handle: "@Renfail",
    channelId: "UCcS1qP2cMclrKSmTe2HPcGQ",
    url: "https://www.youtube.com/@Renfail",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcS1qP2cMclrKSmTe2HPcGQ",
    authority: "creator",
    topics: ["lets-play", "reforged", "first-impressions"]
  }
];

export function listYouTubeSources(scope: YouTubeVideoSearchOptions["scope"] = "all"): YouTubeSource[] {
  if (scope === "official") {
    return YOUTUBE_SOURCES.filter((source) => source.authority === "official");
  }
  if (scope === "creators") {
    return YOUTUBE_SOURCES.filter((source) => source.authority !== "official");
  }
  return [...YOUTUBE_SOURCES];
}

export function parseYouTubeFeed(xml: string): Array<Omit<YouTubeVideo, "sourceId" | "sourceTitle" | "sourceAuthority">> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const videos: Array<Omit<YouTubeVideo, "sourceId" | "sourceTitle" | "sourceAuthority">> = [];

  $("entry").each((_, entry) => {
    const node = $(entry);
    const videoId = node.children("yt\\:videoId, videoId").first().text().trim();
    const title = node.children("title").first().text().trim();
    const url = node.children("link[rel='alternate']").attr("href") ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    if (!videoId || !title || !url) {
      return;
    }

    videos.push({
      videoId,
      title,
      url,
      publishedAt: node.children("published").first().text().trim() || undefined,
      updatedAt: node.children("updated").first().text().trim() || undefined,
      channelTitle: node.find("author > name").first().text().trim() || undefined,
      thumbnailUrl: node.find("media\\:thumbnail, thumbnail").first().attr("url")
    });
  });

  return videos;
}

function matchesQuery(video: Pick<YouTubeVideo, "title" | "channelTitle">, query: string | undefined): boolean {
  if (!query) {
    const haystack = `${video.title} ${video.channelTitle ?? ""}`.toLowerCase();
    return GUILD_WARS_TERMS.some((term) => haystack.includes(term));
  }
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const haystack = `${video.title} ${video.channelTitle ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export async function getYouTubeVideos(options: YouTubeVideoSearchOptions = {}): Promise<YouTubeVideoSearch> {
  const limitPerSource = Math.min(Math.max(options.limitPerSource ?? 5, 1), 25);
  const maxTotal = Math.min(Math.max(options.maxTotal ?? 25, 1), 100);
  const baseSources = options.sourceIds?.length ? options.sourceIds : listYouTubeSources(options.scope ?? "all").map((source) => source.id);
  const byId = new Map(YOUTUBE_SOURCES.map((source) => [source.id, source]));
  const selectedSources = baseSources.map((id) => byId.get(id)).filter((source): source is YouTubeSource => source !== undefined);
  const failedSources: YouTubeVideoSearch["failedSources"] = baseSources
    .filter((id) => !byId.has(id))
    .map((id) => ({ id, title: id, url: "", reason: "Unknown YouTube source id." }));
  const videos: YouTubeVideo[] = [];

  await Promise.all(
    selectedSources.map(async (source) => {
      try {
        const feed = await fetchText(source.feedUrl, { accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8" });
        const parsed = parseYouTubeFeed(feed)
          .filter((video) => matchesQuery(video, options.query))
          .slice(0, limitPerSource)
          .map((video) => ({
            ...video,
            sourceId: source.id,
            sourceTitle: source.title,
            sourceAuthority: source.authority
          }));
        videos.push(...parsed);
      } catch (error) {
        failedSources.push({
          id: source.id,
          title: source.title,
          url: source.feedUrl,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  videos.sort((a, b) => (b.publishedAt ?? b.updatedAt ?? "").localeCompare(a.publishedAt ?? a.updatedAt ?? ""));

  return {
    query: options.query,
    sources: selectedSources,
    videos: videos.slice(0, maxTotal),
    failedSources
  };
}
