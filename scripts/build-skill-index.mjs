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
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RANGES = ["1-500", "501-1000", "1001-1500", "1501-2000", "2001-2500", "2501-3000", "3001-3500"];
const API = "https://wiki.guildwars.com/api.php";
const RAW = "https://wiki.guildwars.com/index.php";
const SOURCE_PAGE = "https://wiki.guildwars.com/wiki/Guild_Wars_Wiki:Game_integration/Skills";
const UA = { headers: { "user-agent": "guildwars1-mcp skill-index builder (arthur@sabintsev.com)" } };

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

async function fetchJson(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// 1) id -> name from the machine-readable list
const idToName = new Map();
for (const range of RANGES) {
  const url = `${RAW}?title=Guild_Wars_Wiki:Game_integration/Skills/${range}&action=raw`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`Failed range ${range}: HTTP ${res.status}`);
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
  const en = numOrNull(box.energy); if (en) out.en = en;
  const ac = numOrNull(box.activation); if (ac) out.ac = ac;
  const re = numOrNull(box.recharge); if (re) out.re = re;
  const ad = numOrNull(box.adrenaline); if (ad) out.ad = ad;
  const up = numOrNull(box.upkeep); if (up) out.up = up;

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

let done = 0;
for (let i = 0; i < names.length; i += 40) {
  const batch = names.slice(i, i + 40);
  const url = `${API}?action=query&prop=categories|revisions&cllimit=500&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(batch.join("|"))}`;
  let data;
  try { data = await fetchJson(url); }
  catch (e) { console.error(`batch ${i} failed: ${e.message}; retrying`); await new Promise(r => setTimeout(r, 1000)); data = await fetchJson(url); }
  const norm = {}; (data.query.normalized || []).forEach(n => norm[n.from] = n.to);
  const byTitle = {};
  for (const p of Object.values(data.query.pages)) {
    byTitle[p.title] = {
      cats: (p.categories || []).map(c => c.title),
      text: p.revisions?.[0]?.slots?.main?.["*"] || ""
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
const withEnergy = [...meta.values()].filter(m => m.en).length;

const out = `// AUTO-GENERATED by scripts/build-skill-index.mjs — do not edit by hand.
// Source (Guild Wars Wiki, not game files): ${SOURCE_PAGE}
// Run \`npm run skills:build\` to refresh.

export const SKILL_INDEX_SOURCE = ${JSON.stringify(SOURCE_PAGE)};
export const SKILL_INDEX_COUNT = ${idToName.size};

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

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "skills.generated.ts");
await writeFile(target, out, "utf8");
console.error(`Wrote ${idToName.size} skills (${eliteCount} elite, ${pveCount} PvE-only, ${withEnergy} with energy cost) to ${target}`);
