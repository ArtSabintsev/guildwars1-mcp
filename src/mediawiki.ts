import { fetchJson } from "./http.js";
import { WIKI_SOURCES, type WikiSourceId, wikiPageUrl } from "./sources.js";
import { stripHtml, truncateText } from "./text.js";

export type WikiSearchResult = {
  sourceId: WikiSourceId;
  sourceTitle: string;
  title: string;
  pageId: number;
  snippet: string;
  wordCount?: number;
  size?: number;
  timestamp?: string;
  url: string;
};

export type WikiPage = {
  sourceId: WikiSourceId;
  sourceTitle: string;
  title: string;
  pageId: number;
  url: string;
  extract: string;
  categories: string[];
  links: string[];
  revision?: {
    id?: number;
    parentId?: number;
    timestamp?: string;
    comment?: string;
  };
};

export type WikiRecentChange = {
  sourceId: WikiSourceId;
  sourceTitle: string;
  title: string;
  pageId?: number;
  revisionId?: number;
  oldRevisionId?: number;
  timestamp?: string;
  type?: string;
  comment?: string;
  url: string;
};

// TTL for reads whose whole point is freshness (recent changes, game updates).
const FAST_MOVING_TTL_MS = 60_000;

type ApiError = {
  error?: {
    code?: string;
    info?: string;
  };
};

// MediaWiki reports failures (rate limits, blocked clients, bad params) inside
// a 200 response; without this check they would surface as empty result lists.
function assertNoApiError(response: ApiError, sourceTitle: string): void {
  if (response.error) {
    const code = response.error.code ?? "unknown";
    const info = response.error.info ?? "no details provided";
    throw new Error(`${sourceTitle} API error (${code}): ${info}`);
  }
}

// Keeps transient in-band API errors (delivered with HTTP 200) out of the
// shared cache, so a momentary rate limit is not replayed for a full TTL.
function notApiErrorPayload(body: string): boolean {
  try {
    return !(JSON.parse(body) as ApiError).error;
  } catch {
    return true;
  }
}

type SearchResponse = ApiError & {
  query?: {
    search?: Array<{
      title: string;
      pageid: number;
      snippet?: string;
      wordcount?: number;
      size?: number;
      timestamp?: string;
    }>;
  };
};

type PageResponse = ApiError & {
  query?: {
    pages?: Record<
      string,
      {
        missing?: boolean;
        pageid?: number;
        title?: string;
        fullurl?: string;
        extract?: string;
        categories?: Array<{ title: string }>;
        links?: Array<{ title: string }>;
        revisions?: Array<{
          revid?: number;
          parentid?: number;
          timestamp?: string;
          comment?: string;
        }>;
      }
    >;
  };
};

type RecentChangesResponse = ApiError & {
  query?: {
    recentchanges?: Array<{
      type?: string;
      title: string;
      pageid?: number;
      revid?: number;
      old_revid?: number;
      timestamp?: string;
      comment?: string;
    }>;
  };
};

export async function searchWiki(sourceId: WikiSourceId, query: string, limit: number): Promise<WikiSearchResult[]> {
  const source = WIKI_SOURCES[sourceId];
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    srwhat: "text",
    format: "json",
    origin: "*"
  });
  const response = await fetchJson<SearchResponse>(`${source.apiUrl}?${params.toString()}`, {
    cacheable: notApiErrorPayload
  });
  assertNoApiError(response, source.title);

  return (response.query?.search ?? []).map((result) => ({
    sourceId,
    sourceTitle: source.title,
    title: result.title,
    pageId: result.pageid,
    snippet: stripHtml(result.snippet ?? ""),
    wordCount: result.wordcount,
    size: result.size,
    timestamp: result.timestamp,
    url: wikiPageUrl(sourceId, result.title)
  }));
}

export type GetWikiPageOptions = {
  cacheTtlMs?: number;
};

export async function getWikiPage(
  sourceId: WikiSourceId,
  title: string,
  maxCharacters: number,
  options: GetWikiPageOptions = {}
): Promise<WikiPage> {
  const source = WIKI_SOURCES[sourceId];
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts|info|categories|links|revisions",
    inprop: "url",
    explaintext: "1",
    exsectionformat: "plain",
    cllimit: "50",
    pllimit: "50",
    rvprop: "ids|timestamp|comment",
    rvlimit: "1",
    format: "json",
    redirects: "1",
    origin: "*"
  });
  const response = await fetchJson<PageResponse>(`${source.apiUrl}?${params.toString()}`, {
    cacheTtlMs: options.cacheTtlMs,
    cacheable: notApiErrorPayload
  });
  assertNoApiError(response, source.title);
  const page = Object.values(response.query?.pages ?? {})[0];

  if (!page || page.missing || page.pageid === undefined || !page.title) {
    throw new Error(`No ${source.title} page found for "${title}".`);
  }

  const revision = page.revisions?.[0];
  return {
    sourceId,
    sourceTitle: source.title,
    title: page.title,
    pageId: page.pageid,
    url: page.fullurl ?? wikiPageUrl(sourceId, page.title),
    extract: truncateText(page.extract ?? "", maxCharacters),
    categories: (page.categories ?? []).map((category) => category.title.replace(/^Category:/, "")).sort(),
    links: (page.links ?? []).map((link) => link.title).sort(),
    revision:
      revision === undefined
        ? undefined
        : {
            id: revision.revid,
            parentId: revision.parentid,
            timestamp: revision.timestamp,
            comment: revision.comment
          }
  };
}

export async function getRecentChanges(sourceId: WikiSourceId, limit: number): Promise<WikiRecentChange[]> {
  const source = WIKI_SOURCES[sourceId];
  const params = new URLSearchParams({
    action: "query",
    list: "recentchanges",
    rcprop: "title|timestamp|ids|comment|sizes|flags",
    rclimit: String(limit),
    format: "json",
    origin: "*"
  });
  const response = await fetchJson<RecentChangesResponse>(`${source.apiUrl}?${params.toString()}`, {
    cacheTtlMs: FAST_MOVING_TTL_MS,
    cacheable: notApiErrorPayload
  });
  assertNoApiError(response, source.title);

  return (response.query?.recentchanges ?? []).map((change) => ({
    sourceId,
    sourceTitle: source.title,
    title: change.title,
    pageId: change.pageid,
    revisionId: change.revid,
    oldRevisionId: change.old_revid,
    timestamp: change.timestamp,
    type: change.type,
    comment: change.comment,
    url: wikiPageUrl(sourceId, change.title)
  }));
}

export type GameUpdateSection = {
  heading: string;
  dateText?: string;
  url: string;
  text: string;
};

export async function getGameUpdateSections(limit: number, maxCharactersPerSection = 3000): Promise<GameUpdateSection[]> {
  const page = await getWikiPage("gww", "Game updates", 40_000, { cacheTtlMs: FAST_MOVING_TTL_MS });
  const sections: GameUpdateSection[] = [];
  const pattern = /^(?:==\s*)?(Update [A-Z][^=\n]+?)(?:\s*==)?\s*$/gm;
  const matches = [...page.extract.matchAll(pattern)];

  for (let index = 0; index < matches.length && sections.length < limit; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = match.index === undefined ? 0 : match.index + match[0].length;
    const end = next?.index ?? page.extract.length;
    const heading = match[1].trim();
    sections.push({
      heading,
      dateText: heading.replace(/^Update\s+/, ""),
      url: `${page.url}#${encodeURIComponent(heading.replaceAll(" ", "_"))}`,
      text: truncateText(page.extract.slice(start, end).trim(), maxCharactersPerSection)
    });
  }

  return sections;
}
