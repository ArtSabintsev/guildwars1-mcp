export type WikiSourceId = "gww" | "pvx";

export type WikiSource = {
  id: WikiSourceId;
  title: string;
  apiUrl: string;
  webUrl: string;
  pageUrlPrefix: string;
  authority: "primary-community" | "build-community";
  notes: string[];
};

export const WIKI_SOURCES: Record<WikiSourceId, WikiSource> = {
  gww: {
    id: "gww",
    title: "Guild Wars Wiki",
    apiUrl: "https://wiki.guildwars.com/api.php",
    webUrl: "https://wiki.guildwars.com/",
    pageUrlPrefix: "https://wiki.guildwars.com/wiki/",
    authority: "primary-community",
    notes: ["Officially hosted community wiki.", "Preferred source for game updates, skills, professions, items, quests, and mechanics."]
  },
  pvx: {
    id: "pvx",
    title: "PvXwiki",
    apiUrl: "https://gwpvx.fandom.com/api.php",
    webUrl: "https://gwpvx.fandom.com/",
    pageUrlPrefix: "https://gwpvx.fandom.com/wiki/",
    authority: "build-community",
    notes: ["Fandom-hosted build archive.", "Preferred source for historical and maintained PvE, PvP, farming, and team build pages."]
  }
};

export const SOURCE_SCOPE = {
  game: "Guild Wars 1",
  server: "guildwars1-mcp",
  defaultBehavior: "Public read-only sources only. Local inventory requires explicit roots."
};

export const PUBLIC_SOURCES = [
  {
    id: "guild-wars-wiki",
    title: "Guild Wars Wiki",
    kind: "mediawiki",
    url: WIKI_SOURCES.gww.webUrl,
    apiUrl: WIKI_SOURCES.gww.apiUrl,
    authority: WIKI_SOURCES.gww.authority
  },
  {
    id: "pvxwiki",
    title: "PvXwiki",
    kind: "mediawiki",
    url: WIKI_SOURCES.pvx.webUrl,
    apiUrl: WIKI_SOURCES.pvx.apiUrl,
    authority: WIKI_SOURCES.pvx.authority
  },
  {
    id: "gw1builds",
    title: "GW1 Builds",
    kind: "public-build-api",
    url: "https://gw1builds.com/",
    apiUrl: "https://gw1builds.com/api/builds",
    authority: "community-builds"
  },
  {
    id: "guildwars-subreddit",
    title: "r/GuildWars",
    kind: "public-atom-search",
    url: "https://www.reddit.com/r/GuildWars/",
    apiUrl: "https://www.reddit.com/r/GuildWars/search.rss",
    authority: "community-discussion"
  },
  {
    id: "local-inventory",
    title: "Local Guild Wars install inventory",
    kind: "explicit-local-filesystem",
    url: "gw1://local-inventory",
    authority: "user-controlled-local",
    notes: ["Disabled unless GW1_LOCAL_ROOTS or explicit tool-call roots are provided.", "Returns metadata only and redacts paths by default."]
  }
];

export function wikiPageUrl(sourceId: WikiSourceId, title: string): string {
  return `${WIKI_SOURCES[sourceId].pageUrlPrefix}${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}
