import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { encodeSkillTemplate, validateBuild } from "./build.js";
import { searchContent } from "./content.js";
import { searchGw1Builds } from "./gw1builds.js";
import { PACKAGE_VERSION } from "./http.js";
import { inventoryLocal } from "./local.js";
import { getGameUpdateSections, getRecentChanges, getWikiPage, searchWiki, type WikiSearchResult } from "./mediawiki.js";
import { searchGuildWarsSubreddit } from "./reddit.js";
import { SKILL_INDEX_PROVENANCE } from "./skills.generated.js";
import { PUBLIC_SOURCES, SOURCE_SCOPE, WIKI_SOURCES, type WikiSourceId } from "./sources.js";
import { analyzeTemplateCode } from "./template.js";
import { getYouTubeVideos, listYouTubeSources, YOUTUBE_SOURCES } from "./youtube.js";

function toolResult(summary: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${summary}\n\n${JSON.stringify(structuredContent, null, 2)}`
      }
    ],
    structuredContent
  };
}

const wikiSourceSchema = z.enum(["gww", "pvx"]);
const wikiSourceOrBothSchema = z.enum(["gww", "pvx", "both"]);

async function searchAllWikis(source: WikiSourceId | "both", query: string, limit: number) {
  const perSourceLimit = source === "both" ? Math.ceil(limit / 2) : limit;
  const sourceIds: WikiSourceId[] = source === "both" ? ["gww", "pvx"] : [source];
  const settled = await Promise.allSettled(sourceIds.map((sourceId) => searchWiki(sourceId, query, perSourceLimit)));

  const results: WikiSearchResult[] = [];
  const failedSources: Array<{ sourceId: WikiSourceId; error: string }> = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
    } else {
      failedSources.push({
        sourceId: sourceIds[index],
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      });
    }
  });

  // Only surrender when every requested wiki failed; one healthy source is still an answer.
  if (failedSources.length === sourceIds.length) {
    // For a single-source request, surface the original error unwrapped.
    const failure = settled[0];
    if (sourceIds.length === 1 && failure.status === "rejected") {
      throw failure.reason;
    }
    throw new Error(`All wiki sources failed: ${failedSources.map((f) => `${f.sourceId}: ${f.error}`).join("; ")}`);
  }
  return { results: results.slice(0, limit), failedSources };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "guildwars1-mcp",
    version: PACKAGE_VERSION
  });

  server.registerResource(
    "sources",
    "gw1://sources",
    {
      title: "Guild Wars 1 source registry",
      description: "Public and opt-in local source registry used by this MCP server.",
      mimeType: "application/json"
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ scope: SOURCE_SCOPE, sources: PUBLIC_SOURCES }, null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "wiki-sources",
    "gw1://wiki-sources",
    {
      title: "Guild Wars 1 wiki source registry",
      description: "MediaWiki API sources used by wiki tools.",
      mimeType: "application/json"
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ sources: WIKI_SOURCES }, null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "youtube-sources",
    "gw1://youtube-sources",
    {
      title: "Guild Wars 1 YouTube source registry",
      description: "Curated official and creator YouTube channel RSS feeds used by this MCP server.",
      mimeType: "application/json"
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ sources: YOUTUBE_SOURCES }, null, 2)
        }
      ]
    })
  );

  server.registerTool(
    "gw1_sources",
    {
      title: "List GW1 sources",
      description: "List public Guild Wars 1 sources and the opt-in local inventory surface known to this server."
    },
    async () =>
      toolResult(`Found ${PUBLIC_SOURCES.length} configured source surfaces.`, {
        scope: SOURCE_SCOPE,
        sources: PUBLIC_SOURCES,
        skillIndex: SKILL_INDEX_PROVENANCE
      })
  );

  server.registerTool(
    "gw1_skill_index_provenance",
    {
      title: "Skill index provenance",
      description:
        "Report where the bundled skill index came from (Guild Wars Wiki, not game files), when it was extracted, which wiki revision it reflects, and its content hash — use this to judge how stale template decode/encode data is."
    },
    async () =>
      toolResult(
        `Skill index of ${SKILL_INDEX_PROVENANCE.counts.total} skills extracted ${SKILL_INDEX_PROVENANCE.extractedAt} from wiki revision ${SKILL_INDEX_PROVENANCE.wikiRevisionId}.`,
        { provenance: SKILL_INDEX_PROVENANCE }
      )
  );

  server.registerTool(
    "gw1_wiki_search",
    {
      title: "Search GW1 wikis",
      description: "Search Guild Wars Wiki, PvXwiki, or both via their public MediaWiki APIs.",
      inputSchema: {
        query: z.string().min(2).max(160),
        source: wikiSourceOrBothSchema.default("both"),
        limit: z.number().int().min(1).max(50).default(10)
      }
    },
    async ({ query, source, limit }) => {
      const { results, failedSources } = await searchAllWikis(source, query, limit);
      const failureNote = failedSources.length > 0 ? ` (${failedSources.map((f) => f.sourceId).join(", ")} unavailable)` : "";
      return toolResult(`Found ${results.length} wiki matches for "${query}"${failureNote}.`, {
        query,
        source,
        results,
        failedSources
      });
    }
  );

  server.registerTool(
    "gw1_wiki_page",
    {
      title: "Read GW1 wiki page",
      description: "Fetch a page from Guild Wars Wiki or PvXwiki and return extracted text, links, categories, and revision metadata without editor usernames.",
      inputSchema: {
        title: z.string().min(1).max(240),
        source: wikiSourceSchema.default("gww"),
        maxCharacters: z.number().int().min(500).max(40_000).default(12_000)
      }
    },
    async ({ title, source, maxCharacters }) => {
      const page = await getWikiPage(source, title, maxCharacters);
      return toolResult(`Fetched ${page.sourceTitle} page "${page.title}".`, { page });
    }
  );

  server.registerTool(
    "gw1_wiki_recent_changes",
    {
      title: "Read GW1 wiki recent changes",
      description: "Return recent public changes from Guild Wars Wiki or PvXwiki without editor usernames.",
      inputSchema: {
        source: wikiSourceSchema.default("gww"),
        limit: z.number().int().min(1).max(50).default(10)
      }
    },
    async ({ source, limit }) => {
      const changes = await getRecentChanges(source, limit);
      return toolResult(`Fetched ${changes.length} recent ${WIKI_SOURCES[source].title} changes.`, { source, changes });
    }
  );

  server.registerTool(
    "gw1_game_updates",
    {
      title: "Read GW1 game updates",
      description: "Parse recent game-update sections from the Guild Wars Wiki Game updates page.",
      inputSchema: {
        limit: z.number().int().min(1).max(25).default(5),
        maxCharactersPerSection: z.number().int().min(300).max(10_000).default(3000)
      }
    },
    async ({ limit, maxCharactersPerSection }) => {
      const updates = await getGameUpdateSections(limit, maxCharactersPerSection);
      return toolResult(`Fetched ${updates.length} Guild Wars update section(s).`, { updates });
    }
  );

  server.registerTool(
    "gw1_builds_search",
    {
      title: "Search GW1 builds",
      description: "Search GW1 Builds public API and/or PvXwiki build pages. Author/handle fields are omitted unless includeAuthors is true.",
      inputSchema: {
        query: z.string().min(0).max(160).default(""),
        source: z.enum(["gw1builds", "pvx", "all"]).default("all"),
        limit: z.number().int().min(1).max(50).default(10),
        includeAuthors: z.boolean().default(false)
      }
    },
    async ({ query, source, limit, includeAuthors }) => {
      const trimmedQuery = query.trim();
      const gw1builds = source === "pvx" ? undefined : await searchGw1Builds({ query: trimmedQuery || undefined, limit, includeAuthors });
      const pvx = source === "gw1builds" || !trimmedQuery ? [] : await searchWiki("pvx", trimmedQuery, limit);
      return toolResult(`Fetched build results for "${trimmedQuery || "recent/popular"}".`, {
        query: trimmedQuery,
        source,
        gw1builds,
        pvx: pvx.slice(0, limit)
      });
    }
  );

  server.registerTool(
    "gw1_template_code_analyze",
    {
      title: "Analyze GW1 template code",
      description:
        "Validate, classify, and decode a Guild Wars template/build code. Skill templates are fully decoded into primary/secondary professions, attributes with points, and the eight skills resolved to names via the bundled Guild Wars Wiki skill index.",
      inputSchema: {
        input: z.string().min(1).max(500)
      }
    },
    async ({ input }) => {
      const analysis = analyzeTemplateCode(input);
      const validation = analysis.decoded ? validateBuild(analysis.decoded) : undefined;
      const summary = analysis.decoded
        ? `Decoded ${analysis.decoded.primary.name}/${analysis.decoded.secondary.name} (${validation?.legal ? "legal" : "ILLEGAL"}): ${analysis.decoded.skills.map((skill) => skill.name).join(", ")}.`
        : `Template code ${analysis.plausible ? "looks plausible" : "needs review"}.`;
      return toolResult(summary, { analysis, validation });
    }
  );

  server.registerTool(
    "gw1_template_encode",
    {
      title: "Build & encode a GW1 skill template",
      description:
        "Build a Guild Wars skill template from professions, attributes, and skill names. Returns an importable template code, a legality report (one elite max, three PvE-only max, single allegiance, 200 attribute-point budget, profession checks), per-skill energy/cast/recharge/adrenaline costs, and an energy-sustainability outlook. Use this to construct and sanity-check a build before sharing it.",
      inputSchema: {
        primary: z.string().min(1).describe("Primary profession, e.g. 'Dervish'."),
        secondary: z.string().default("None").describe("Secondary profession, or 'None'."),
        attributes: z
          .array(z.object({ attribute: z.string().min(1), points: z.number().int().min(0).max(12) }))
          .default([])
          .describe("Base attribute spend (0-12 each), e.g. [{attribute:'Scythe Mastery',points:12}]."),
        skills: z
          .array(z.string().min(1))
          .min(1)
          .max(8)
          .describe("Up to 8 skill names, e.g. 'Wounding Strike'. Use exact wiki names.")
      }
    },
    async ({ primary, secondary, attributes, skills }) => {
      try {
        const result = encodeSkillTemplate({ primary, secondary, attributes, skills });
        const verdict = result.validation.legal ? "legal" : "ILLEGAL";
        return toolResult(
          `Encoded ${result.decoded.primary.name}/${result.decoded.secondary.name} (${verdict}, energy: ${result.validation.resources.energyOutlook}): ${result.code}`,
          { ...result }
        );
      } catch (error) {
        return toolResult(`Could not encode build: ${error instanceof Error ? error.message : String(error)}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  );

  server.registerTool(
    "gw1_subreddit_search",
    {
      title: "Search r/GuildWars",
      description: "Search r/GuildWars public Atom results. Author/handle fields are omitted unless includeAuthors is true.",
      inputSchema: {
        query: z.string().min(2).max(160),
        limit: z.number().int().min(1).max(25).default(10),
        sort: z.enum(["relevance", "hot", "top", "new", "comments"]).default("new"),
        includeAuthors: z.boolean().default(false),
        maxCharacters: z.number().int().min(100).max(4000).default(800)
      }
    },
    async ({ query, limit, sort, includeAuthors, maxCharacters }) => {
      const search = await searchGuildWarsSubreddit({ query, limit, sort, includeAuthors, maxCharacters });
      return toolResult(`Found ${search.results.length} r/GuildWars result(s) for "${query}".`, search);
    }
  );

  server.registerTool(
    "gw1_youtube_sources",
    {
      title: "List GW1 YouTube sources",
      description: "List curated official and creator YouTube channel feeds for Guild Wars 1, Reforged, build, skill, and guide content.",
      inputSchema: {
        scope: z.enum(["official", "creators", "all"]).default("all")
      }
    },
    async ({ scope }) => {
      const sources = listYouTubeSources(scope);
      return toolResult(`Found ${sources.length} YouTube source(s).`, { scope, sources });
    }
  );

  server.registerTool(
    "gw1_youtube_videos",
    {
      title: "Search GW1 YouTube videos",
      description: "Fetch recent videos from curated public YouTube RSS feeds. Without a query, filters to likely Guild Wars 1/Reforged videos.",
      inputSchema: {
        query: z.string().min(1).max(160).optional(),
        scope: z.enum(["official", "creators", "all"]).default("all"),
        sourceIds: z.array(z.string().min(1)).optional(),
        limitPerSource: z.number().int().min(1).max(25).default(5),
        maxTotal: z.number().int().min(1).max(100).default(25)
      }
    },
    async ({ query, scope, sourceIds, limitPerSource, maxTotal }) => {
      const search = await getYouTubeVideos({ query, scope, sourceIds, limitPerSource, maxTotal });
      const failureNote = search.failedSources.length > 0 ? ` ${search.failedSources.length} source(s) failed and are listed in failedSources.` : "";
      return toolResult(`Fetched ${search.videos.length} YouTube video(s).${failureNote}`, search);
    }
  );

  server.registerTool(
    "gw1_content_search",
    {
      title: "Search GW1 content",
      description: "Search across Guild Wars Wiki, PvXwiki, GW1 Builds, YouTube, and r/GuildWars for current public content.",
      inputSchema: {
        query: z.string().min(2).max(160),
        sources: z.array(z.enum(["wiki", "pvx", "gw1builds", "youtube", "reddit"])).optional(),
        limitPerSource: z.number().int().min(1).max(20).default(5),
        includeAuthors: z.boolean().default(false)
      }
    },
    async ({ query, sources, limitPerSource, includeAuthors }) => {
      const search = await searchContent({ query, sources, limitPerSource, includeAuthors });
      const failureNote = search.failedSources.length > 0 ? ` ${search.failedSources.length} source(s) failed and are listed in failedSources.` : "";
      return toolResult(`Found ${search.results.length} content result(s) for "${query}".${failureNote}`, search);
    }
  );

  server.registerTool(
    "gw1_local_inventory",
    {
      title: "Inventory local GW1 install",
      description:
        "Opt-in local scanner for Guild Wars installs or VMware Fusion bundles. It never scans default locations. Pass explicit roots or set GW1_LOCAL_ROOTS. Paths are redacted by default.",
      inputSchema: {
        roots: z.array(z.string().min(1)).optional(),
        useEnvRoots: z.boolean().default(true),
        maxDepth: z.number().int().min(0).max(12).default(6),
        maxEntries: z.number().int().min(1).max(5000).default(500),
        includeHeaderHashes: z.boolean().default(false),
        redactPaths: z.boolean().default(true)
      }
    },
    async ({ roots, useEnvRoots, maxDepth, maxEntries, includeHeaderHashes, redactPaths }) => {
      const inventory = await inventoryLocal({ roots, useEnvRoots, maxDepth, maxEntries, includeHeaderHashes, redactPaths });
      return toolResult(inventory.enabled ? `Scanned ${inventory.rootsScanned} explicit root(s).` : "Local inventory is disabled.", { inventory });
    }
  );

  return server;
}
