// Regenerates src/skills.generated.ts from the Guild Wars Wiki.
// Produces two maps:
//   SKILL_NAMES : id -> canonical skill name (from the machine-readable skill list)
//   SKILL_META  : id -> { p?:professionId, a?:attributeId, e?:1 elite, v?:1 PvE-only,
//                         k?:1 Kurzick, l?:1 Luxon, x?:1 has-a-PvP-version, rz?:1 resurrection,
//                         en?:energy, ac?:activation/cast seconds, re?:recharge seconds,
//                         ad?:adrenaline, up?:upkeep }
// Data source (NOT game files):
//   https://wiki.guildwars.com/wiki/Guild_Wars_Wiki:Game_integration/Skills  (id -> name)
//   per-skill categories + infobox wikitext via the MediaWiki API           (metadata)
//
// Usage: npm run skills:build
//        npm run skills:check   (extract in memory, exit 1 if data differs from the committed index)
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECK_MODE = process.argv.includes("--check");

const RANGES = ["1-500", "501-1000", "1001-1500", "1501-2000", "2001-2500", "2501-3000", "3001-3500"];
const API = "https://wiki.guildwars.com/api.php";
const RAW = "https://wiki.guildwars.com/index.php";
const SOURCE_PAGE = "https://wiki.guildwars.com/wiki/Guild_Wars_Wiki:Game_integration/Skills";
// Same "<client>/<version> (<contact>)" User-Agent as src/http.ts — the wiki
// 403s anything that doesn't match the MediaWiki User-Agent policy shape.
const PACKAGE_VERSION = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
).version;
const UA = {
  headers: {
    "user-agent": `guildwars1-mcp/${PACKAGE_VERSION} (+https://github.com/ArtSabintsev/guildwars1-mcp)`,
  },
};

const LINE_PATTERN = /Game link:Skill (\d+)\|redirect=no\}\}[^\]]*\][^[]*\[\[([^\]]+?)\]\]/g;

const PROFESSION_ID = {
  Warrior: 1, Ranger: 2, Monk: 3, Necromancer: 4, Mesmer: 5, Elementalist: 6,
  Assassin: 7, Ritualist: 8, Paragon: 9, Dervish: 10
};
const ATTRIBUTE_ID = {
  "Fast Casting": 0, "Illusion Magic": 1, "Domination Magic": 2, "Inspiration Magic": 3,
  "Blood Magic": 4, "Death Magic": 5, "Soul Reaping": 6, "Curses": 7, "Air Magic": 8,
  "Earth Magic": 9, "Fire Magic": 10, "Water Magic": 11, "Energy Storage": 12,
  "Healing Prayers": 13, "Smiting Prayers": 14, "Protection Prayers": 15, "Divine Favor": 16,
  "Strength": 17, "Axe Mastery": 18, "Hammer Mastery": 19, "Swordsmanship": 20, "Tactics": 21,
  "Beast Mastery": 22, "Expertise": 23, "Wilderness Survival": 24, "Marksmanship": 25,
  "Dagger Mastery": 29, "Deadly Arts": 30, "Shadow Arts": 31, "Communing": 32,
  "Restoration Magic": 33, "Channeling Magic": 34, "Critical Strikes": 35, "Spawning Power": 36,
  "Spear Mastery": 37, "Command": 38, "Motivation": 39, "Leadership": 40, "Scythe Mastery": 41,
  "Wind Prayers": 42, "Earth Prayers": 43, "Mysticism": 44
};

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...UA, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        console.error(`fetch attempt ${attempt} failed for ${url}: ${error.message}; retrying`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url);
  const data = await res.json();
  if (data.error) throw new Error(`MediaWiki API error (${data.error.code ?? "unknown"}): ${data.error.info ?? url}`);
  if (!data.query) throw new Error(`MediaWiki response has no "query" field for ${url}`);
  return data;
}

// 1) id -> name from the machine-readable list
const idToName = new Map();
for (const range of RANGES) {
  const url = `${RAW}?title=Guild_Wars_Wiki:Game_integration/Skills/${range}&action=raw`;
  const res = await fetchWithRetry(url);
  const text = await res.text();
  for (const m of text.matchAll(LINE_PATTERN)) {
    const id = Number(m[1]);
    const name = m[2].split("|")[0].trim();
    if (Number.isInteger(id) && name) idToName.set(id, name);
  }
  console.error(`names: range ${range} -> total ${idToName.size}`);
}
if (idToName.size < 2000) throw new Error(`Only ${idToName.size} skills parsed; wiki format may have changed.`);

// 2) per-name categories + infobox wikitext -> metadata (applied to every id sharing the name)
const nameToIds = new Map();
for (const [id, n] of idToName) {
  if (!nameToIds.has(n)) nameToIds.set(n, []);
  nameToIds.get(n).push(id);
}
const names = [...nameToIds.keys()];
const meta = new Map();

function numOrNull(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (/^\{\{1\/4/.test(v)) return 0.25;
  if (/^\{\{1\/2/.test(v)) return 0.5;
  if (/^\{\{3\/4/.test(v)) return 0.75;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : null;
}

function parseInfobox(wikitext) {
  const fields = {};
  if (!wikitext) return fields;
  for (const line of wikitext.split("\n")) {
    const m = line.match(/^\|\s*([\w-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "description" || key === "concise") break; // numeric fields precede the description
    fields[key] = m[2].trim();
  }
  return fields;
}

function deriveMeta(cats, wikitext) {
  const out = {};
  const box = parseInfobox(wikitext);

  if (box.profession && PROFESSION_ID[box.profession] !== undefined) out.p = PROFESSION_ID[box.profession];
  if (box.attribute && ATTRIBUTE_ID[box.attribute] !== undefined) out.a = ATTRIBUTE_ID[box.attribute];
  if (/^y/i.test(box.elite || "")) out.e = 1;
  if (/^y/i.test(box["has-pvp"] || "")) out.x = 1;
  const en = numOrNull(box.energy); if (en != null) out.en = en;
  const ac = numOrNull(box.activation); if (ac != null) out.ac = ac;
  const re = numOrNull(box.recharge); if (re != null) out.re = re;
  const ad = numOrNull(box.adrenaline); if (ad != null) out.ad = ad;
  const up = numOrNull(box.upkeep); if (up != null) out.up = up;

  // categories: PvE-only, allegiance, resurrection (and as fallback for prof/attr/elite/pvp)
  for (const c of cats) {
    const name = c.replace(/^Category:/, "");
    if (name === "Elite skills") out.e = 1;
    if (/ rank skills$/.test(name) || /PvE-only skills$/.test(name)) out.v = 1;
    if (/Kurzick/.test(name)) { out.k = 1; out.v = 1; }
    if (/Luxon/.test(name)) { out.l = 1; out.v = 1; }
    if (name === "PvE versions of skills") out.x = 1;
    if (name === "Resurrection skills") out.rz = 1;
    if (name === "Skills that cause Energy Gain" || name === "Skills that cause Decreased Energy Cost") out.em = 1;
    if (/^Skills that cause (Healing|Health Regeneration|Health Gain|Life Stealing)$/.test(name)) out.hl = 1;
    if (name === "Sacrifice skills") out.sac = 1;
    if (out.p === undefined) { const pm = name.match(/^(\w+) skills$/); if (pm && PROFESSION_ID[pm[1]] !== undefined) out.p = PROFESSION_ID[pm[1]]; }
    if (out.a === undefined) { const am = name.match(/^(.+) skills$/); if (am && ATTRIBUTE_ID[am[1]] !== undefined) out.a = ATTRIBUTE_ID[am[1]]; }
  }
  return out;
}

// SKILL_META comes from per-skill pages that can change independently of the
// range pages, so track their newest revision too — otherwise provenance
// claims an unchanged wiki revision for changed metadata.
let metaMaxRevId = 0;
let metaMaxRevTimestamp = "";
let done = 0;
for (let i = 0; i < names.length; i += 40) {
  const batch = names.slice(i, i + 40);
  const url = `${API}?action=query&prop=categories|revisions&cllimit=500&rvprop=ids|timestamp|content&rvslots=main&format=json&titles=${encodeURIComponent(batch.join("|"))}`;
  const data = await fetchJson(url); // fetchJson already retries transient failures
  const norm = {}; (data.query.normalized || []).forEach(n => norm[n.from] = n.to);
  const byTitle = {};
  for (const p of Object.values(data.query.pages)) {
    const rev = p.revisions?.[0];
    if (rev && rev.revid > metaMaxRevId) {
      metaMaxRevId = rev.revid;
      metaMaxRevTimestamp = rev.timestamp;
    }
    byTitle[p.title] = {
      cats: (p.categories || []).map(c => c.title),
      text: rev?.slots?.main?.["*"] || ""
    };
  }
  for (const requested of batch) {
    const resolved = norm[requested] || requested;
    const page = byTitle[resolved] || { cats: [], text: "" };
    const derived = deriveMeta(page.cats, page.text);
    for (const id of nameToIds.get(requested) || []) meta.set(id, derived);
  }
  done += batch.length;
  if (done % 400 === 0 || done === names.length) console.error(`meta: ${done}/${names.length}`);
}

// 3) emit
const ids = [...idToName.keys()].sort((a, b) => a - b);
const nameEntries = ids.map(id => `  "${id}": ${JSON.stringify(idToName.get(id))}`).join(",\n");
const metaEntries = ids.map(id => {
  const m = meta.get(id) || {};
  const parts = [];
  for (const k of ["p", "a", "e", "v", "k", "l", "x", "rz", "em", "hl", "sac", "en", "ac", "re", "ad", "up"]) {
    if (m[k] !== undefined) parts.push(`${k}:${m[k]}`);
  }
  return `  "${id}": {${parts.join(",")}}`;
}).join(",\n");

const eliteCount = [...meta.values()].filter(m => m.e).length;
const pveCount = [...meta.values()].filter(m => m.v).length;
const withEnergy = [...meta.values()].filter(m => m.en != null).length;

// Content hash covers only the extracted data, so provenance fields (extraction
// timestamp, revision ids) never make an unchanged dataset look changed.
const contentSha256 = createHash("sha256").update(nameEntries).update("\n").update(metaEntries).digest("hex");

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "skills.generated.ts");

if (CHECK_MODE) {
  let existingHash = null;
  try {
    const existing = await readFile(target, "utf8");
    existingHash = existing.match(/"contentSha256":\s*"([0-9a-f]{64})"/)?.[1] ?? null;
  } catch {
    // Missing or unreadable file counts as changed.
  }
  if (existingHash === contentSha256) {
    console.error(`skill index unchanged (${contentSha256.slice(0, 12)}…, ${idToName.size} skills)`);
    process.exit(0);
  }
  console.error(`skill index CHANGED: committed ${existingHash ?? "none"} vs extracted ${contentSha256}`);
  // Exit 10 distinguishes "data changed" from a crashed extraction (any other
  // nonzero), so the refresh workflow never mistakes an outage for a change.
  process.exit(10);
}

// Highest revision across every page this index reflects: the machine-readable
// range pages (names) and the per-skill pages (metadata, tracked above).
const rangeTitles = RANGES.map((range) => `Guild_Wars_Wiki:Game_integration/Skills/${range}`).join("|");
const revisionData = await fetchJson(
  `${API}?action=query&prop=revisions&rvprop=ids|timestamp&format=json&titles=${encodeURIComponent(rangeTitles)}`
);
let wikiRevisionId = metaMaxRevId;
let wikiRevisionTimestamp = metaMaxRevTimestamp;
for (const page of Object.values(revisionData.query.pages)) {
  const rev = page.revisions?.[0];
  if (rev && rev.revid > wikiRevisionId) {
    wikiRevisionId = rev.revid;
    wikiRevisionTimestamp = rev.timestamp;
  }
}

const provenance = {
  source: SOURCE_PAGE,
  extractedAt: new Date().toISOString(),
  wikiRevisionId,
  wikiRevisionTimestamp,
  contentSha256,
  counts: { total: idToName.size, elite: eliteCount, pveOnly: pveCount, withEnergy }
};

const out = `// AUTO-GENERATED by scripts/build-skill-index.mjs — do not edit by hand.
// Source (Guild Wars Wiki, not game files): ${SOURCE_PAGE}
// Run \`npm run skills:build\` to refresh.

export const SKILL_INDEX_SOURCE = ${JSON.stringify(SOURCE_PAGE)};
export const SKILL_INDEX_COUNT = ${idToName.size};

/** Where and when this index was extracted; surfaced via gw1_skill_index_provenance. */
export const SKILL_INDEX_PROVENANCE = ${JSON.stringify(provenance, null, 2)} as const;

/** Skill id -> canonical Guild Wars Wiki skill name. */
export const SKILL_NAMES: Record<string, string> = {
${nameEntries}
};

/**
 * Skill id -> metadata derived from wiki categories + the skill infobox.
 *   p = profession id, a = attribute id, e = elite, v = PvE-only,
 *   k = Kurzick, l = Luxon, x = has a (PvP) version with different stats, rz = resurrection skill,
 *   em = energy-management skill (grants energy or reduces energy cost),
 *   hl = healing/health-sustain skill (heal, health regen, health gain, or life steal),
 *   sac = sacrifices health to use,
 *   en = energy cost, ac = activation/cast seconds, re = recharge seconds,
 *   ad = adrenaline cost, up = upkeep (negative = energy degen pips).
 */
export type SkillMeta = {
  p?: number; a?: number; e?: 1; v?: 1; k?: 1; l?: 1; x?: 1; rz?: 1; em?: 1; hl?: 1; sac?: 1;
  en?: number; ac?: number; re?: number; ad?: number; up?: number;
};
export const SKILL_META: Record<string, SkillMeta> = {
${metaEntries}
};
`;

await writeFile(target, out, "utf8");
console.error(`Wrote ${idToName.size} skills (${eliteCount} elite, ${pveCount} PvE-only, ${withEnergy} with energy cost) to ${target}`);
