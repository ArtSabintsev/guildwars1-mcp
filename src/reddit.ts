import * as cheerio from "cheerio";
import { fetchText } from "./http.js";
import { normalizeWhitespace, stripHtml, truncateText } from "./text.js";

export type SubredditSearchOptions = {
  query: string;
  limit?: number;
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  includeAuthors?: boolean;
  maxCharacters?: number;
};

export type SubredditSearchResult = {
  subreddit: "GuildWars";
  query: string;
  url: string;
  results: Array<{
    title: string;
    url: string;
    id?: string;
    updatedAt?: string;
    author?: string;
    summary: string;
  }>;
};

export async function searchGuildWarsSubreddit(options: SubredditSearchOptions): Promise<SubredditSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);
  const sort = options.sort ?? "new";
  const maxCharacters = Math.min(Math.max(options.maxCharacters ?? 800, 100), 4000);
  const params = new URLSearchParams({
    q: options.query,
    restrict_sr: "on",
    sort,
    limit: String(limit)
  });
  const url = `https://www.reddit.com/r/GuildWars/search.rss?${params.toString()}`;
  const xml = await fetchText(url, { accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8" });

  return {
    subreddit: "GuildWars",
    query: options.query,
    url,
    results: parseRedditAtom(xml, { includeAuthors: options.includeAuthors ?? false, maxCharacters }).slice(0, limit)
  };
}

export function parseRedditAtom(xml: string, options: { includeAuthors?: boolean; maxCharacters?: number } = {}): SubredditSearchResult["results"] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const maxCharacters = options.maxCharacters ?? 800;
  const entries: SubredditSearchResult["results"] = [];

  $("entry").each((_, entry) => {
    const node = $(entry);
    const title = normalizeWhitespace(node.children("title").first().text());
    const link = node.children("link[rel='alternate']").attr("href") ?? node.children("link").first().attr("href") ?? "";
    const content = node.children("content").first().text();
    const summary = truncateText(stripHtml(content), maxCharacters);
    const author = normalizeWhitespace(node.find("author > name").first().text());
    entries.push({
      title,
      url: link,
      id: normalizeWhitespace(node.children("id").first().text()) || undefined,
      updatedAt: normalizeWhitespace(node.children("updated").first().text()) || undefined,
      ...(options.includeAuthors && author ? { author } : {}),
      summary
    });
  });

  return entries;
}
