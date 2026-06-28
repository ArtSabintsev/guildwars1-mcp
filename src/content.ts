import { searchGw1Builds } from "./gw1builds.js";
import { searchWiki } from "./mediawiki.js";
import { searchGuildWarsSubreddit } from "./reddit.js";
import { getYouTubeVideos } from "./youtube.js";

export type ContentSearchOptions = {
  query: string;
  sources?: Array<"wiki" | "pvx" | "gw1builds" | "youtube" | "reddit">;
  limitPerSource?: number;
  includeAuthors?: boolean;
};

export type ContentSearchResult = {
  query: string;
  sources: string[];
  results: Array<{
    source: string;
    title: string;
    url: string;
    summary?: string;
    publishedAt?: string;
    sourceTitle?: string;
    kind?: string;
  }>;
  failedSources: Array<{ source: string; reason: string }>;
};

export async function searchContent(options: ContentSearchOptions): Promise<ContentSearchResult> {
  const sources = options.sources?.length ? options.sources : ["wiki", "pvx", "gw1builds", "youtube", "reddit"];
  const limitPerSource = Math.min(Math.max(options.limitPerSource ?? 5, 1), 20);
  const failedSources: ContentSearchResult["failedSources"] = [];
  const results: ContentSearchResult["results"] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        if (source === "wiki") {
          const matches = await searchWiki("gww", options.query, limitPerSource);
          results.push(...matches.map((match) => ({ source, title: match.title, url: match.url, summary: match.snippet, publishedAt: match.timestamp, sourceTitle: match.sourceTitle, kind: "wiki-page" })));
        } else if (source === "pvx") {
          const matches = await searchWiki("pvx", options.query, limitPerSource);
          results.push(...matches.map((match) => ({ source, title: match.title, url: match.url, summary: match.snippet, publishedAt: match.timestamp, sourceTitle: match.sourceTitle, kind: "build-wiki-page" })));
        } else if (source === "gw1builds") {
          const search = await searchGw1Builds({ query: options.query, limit: limitPerSource, includeAuthors: options.includeAuthors ?? false });
          results.push(...search.results.map((build) => ({ source, title: build.name, url: build.url, summary: build.tags.join(", "), publishedAt: build.createdAt, sourceTitle: "GW1 Builds", kind: "build" })));
        } else if (source === "youtube") {
          const search = await getYouTubeVideos({ query: options.query, limitPerSource, maxTotal: limitPerSource });
          failedSources.push(...search.failedSources.map((failure) => ({ source: `youtube:${failure.id}`, reason: failure.reason })));
          results.push(...search.videos.map((video) => ({ source, title: video.title, url: video.url, publishedAt: video.publishedAt, sourceTitle: video.sourceTitle, kind: "video" })));
        } else if (source === "reddit") {
          const search = await searchGuildWarsSubreddit({ query: options.query, limit: limitPerSource, includeAuthors: options.includeAuthors ?? false });
          results.push(...search.results.map((post) => ({ source, title: post.title, url: post.url, summary: post.summary, publishedAt: post.updatedAt, sourceTitle: "r/GuildWars", kind: "discussion" })));
        }
      } catch (error) {
        failedSources.push({ source, reason: error instanceof Error ? error.message : String(error) });
      }
    })
  );

  results.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  return {
    query: options.query,
    sources,
    results,
    failedSources
  };
}
