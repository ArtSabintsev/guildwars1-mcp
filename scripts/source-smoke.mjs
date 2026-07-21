import { getGameUpdateSections, searchWiki } from "../dist/mediawiki.js";
import { searchGw1Builds } from "../dist/gw1builds.js";
import { searchGuildWarsSubreddit } from "../dist/reddit.js";
import { getYouTubeVideos, listYouTubeSources } from "../dist/youtube.js";
import { searchContent } from "../dist/content.js";

const checks = [];

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true, result });
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await check("guild-wars-wiki-search", async () => {
  const results = await searchWiki("gww", "Skill", 3);
  if (results.length === 0) throw new Error("no Guild Wars Wiki search results");
  return { count: results.length };
});

await check("game-updates", async () => {
  const updates = await getGameUpdateSections(1);
  if (updates.length === 0) throw new Error("no game update sections parsed");
  return { heading: updates[0]?.heading };
});

await check("gw1builds", async () => {
  const results = await searchGw1Builds({ query: "Soul", limit: 2, maxPages: 2 });
  if (results.results.length === 0) throw new Error("no GW1 Builds results");
  return { count: results.results.length };
});

await check("youtube", async () => {
  const search = await getYouTubeVideos({ query: "Guild Wars", maxTotal: 5, limitPerSource: 2 });
  if (search.videos.length === 0) throw new Error("no YouTube videos");
  if (search.failedSources.length > Math.floor(listYouTubeSources("all").length / 2)) {
    throw new Error(`too many failed YouTube feeds: ${search.failedSources.length}`);
  }
  return { videos: search.videos.length, failedSources: search.failedSources.length };
});

await check("reddit", async () => {
  const search = await searchGuildWarsSubreddit({ query: "Reforged", limit: 2 });
  if (search.results.length === 0) throw new Error("no subreddit Atom results");
  return { count: search.results.length };
});

await check("content", async () => {
  const search = await searchContent({ query: "Mesmer", sources: ["wiki", "youtube", "gw1builds"], limitPerSource: 2 });
  if (search.results.length === 0) throw new Error("no cross-source content results");
  return { count: search.results.length, failedSources: search.failedSources.length };
});

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));

const failures = checks.filter((entry) => !entry.ok);
if (failures.length === 0) {
  process.exit(0);
}

// The wiki's AWS load balancer intermittently 403s hosted-CI egress IPs in
// block windows lasting minutes to hours (all endpoints at once). Such a 403
// is purely IP-based and external — a code regression surfaces as a different
// error (parse failure, 404, timeout), never an awselb 403. When every failure
// is a wiki 403, exit 99 so the workflow can tell "upstream is blocking this
// runner right now" apart from a genuine source regression, mirroring
// scripts/build-skill-index.mjs and .github/actions/refresh-skill-index.
const isWikiBlock = (entry) => /wiki\.guildwars\.com/.test(entry.error ?? "") && /HTTP 403\b/.test(entry.error ?? "");
if (failures.every(isWikiBlock)) {
  console.error("wiki.guildwars.com returned 403 for every wiki check — upstream is blocking this network; exiting 99");
  process.exit(99);
}

process.exit(1);
