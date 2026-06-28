import { fetchJson } from "./http.js";

const GW1_BUILDS_API_URL = "https://gw1builds.com/api/builds";
const GW1_BUILDS_PAGE_PREFIX = "https://gw1builds.com/b/";

type RawBuildBar = {
  hero?: string | null;
  name?: string;
  skills?: number[];
  primary?: string;
  secondary?: string;
  template?: string;
  variants?: Array<{ name?: string; template?: string; skills?: number[] }>;
};

type RawGw1Build = {
  id: string;
  name: string;
  tags?: string[];
  bars?: RawBuildBar[];
  star_count?: number;
  view_count?: number;
  created_at?: string;
  author?: string;
};

type Gw1BuildsResponse = {
  builds?: RawGw1Build[];
  nextOffset?: number | null;
};

export type Gw1BuildSearchOptions = {
  query?: string;
  limit?: number;
  maxPages?: number;
  includeAuthors?: boolean;
};

export type Gw1BuildResult = {
  sourceId: "gw1builds";
  id: string;
  name: string;
  url: string;
  tags: string[];
  starCount?: number;
  viewCount?: number;
  createdAt?: string;
  author?: string;
  bars: Array<{
    name?: string;
    hero?: string | null;
    primary?: string;
    secondary?: string;
    template?: string;
    skillIds: number[];
    variants: Array<{ name?: string; template?: string; skillIds: number[] }>;
  }>;
};

export type Gw1BuildSearchResult = {
  query?: string;
  results: Gw1BuildResult[];
  pagesFetched: number;
  nextOffset?: number | null;
};

function buildMatchesQuery(build: RawGw1Build, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = [
    build.id,
    build.name,
    ...(build.tags ?? []),
    ...(build.bars ?? []).flatMap((bar) => [bar.name, bar.hero, bar.primary, bar.secondary, bar.template, ...(bar.variants ?? []).flatMap((variant) => [variant.name, variant.template])])
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function normalizeBuild(build: RawGw1Build, includeAuthors: boolean): Gw1BuildResult {
  return {
    sourceId: "gw1builds",
    id: build.id,
    name: build.name,
    url: `${GW1_BUILDS_PAGE_PREFIX}${encodeURIComponent(build.id)}`,
    tags: build.tags ?? [],
    starCount: build.star_count,
    viewCount: build.view_count,
    createdAt: build.created_at,
    ...(includeAuthors && build.author ? { author: build.author } : {}),
    bars: (build.bars ?? []).map((bar) => ({
      name: bar.name,
      hero: bar.hero,
      primary: bar.primary,
      secondary: bar.secondary,
      template: bar.template,
      skillIds: bar.skills ?? [],
      variants: (bar.variants ?? []).map((variant) => ({
        name: variant.name,
        template: variant.template,
        skillIds: variant.skills ?? []
      }))
    }))
  };
}

export async function searchGw1Builds(options: Gw1BuildSearchOptions = {}): Promise<Gw1BuildSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const maxPages = Math.min(Math.max(options.maxPages ?? 5, 1), 20);
  const query = options.query?.trim();
  const includeAuthors = options.includeAuthors ?? false;
  const results: Gw1BuildResult[] = [];
  let pagesFetched = 0;
  let nextOffset: number | null | undefined = 0;

  while (pagesFetched < maxPages && nextOffset !== null && results.length < limit) {
    const queryString: string = typeof nextOffset === "number" && nextOffset > 0 ? `?offset=${nextOffset}` : "";
    const response: Gw1BuildsResponse = await fetchJson<Gw1BuildsResponse>(`${GW1_BUILDS_API_URL}${queryString}`);
    pagesFetched += 1;
    nextOffset = response.nextOffset;

    for (const build of response.builds ?? []) {
      if (!query || buildMatchesQuery(build, query)) {
        results.push(normalizeBuild(build, includeAuthors));
      }
      if (results.length >= limit) {
        break;
      }
    }
  }

  return {
    query,
    results,
    pagesFetched,
    nextOffset
  };
}
