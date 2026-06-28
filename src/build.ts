import { SKILL_META, SKILL_NAMES } from "./skills.generated.js";
import {
  ATTRIBUTES,
  decodeSkillTemplate,
  PROFESSIONS,
  type DecodedSkillTemplate
} from "./template.js";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SKILL_TEMPLATE_TYPE = 14;
const MAX_ELITES = 1;
const MAX_PVE_ONLY = 3;
const ATTRIBUTE_POINT_BUDGET = 200;
// Cumulative attribute-point cost to reach each rank (0-12), per GW1 mechanics.
const ATTRIBUTE_POINT_COST = [0, 1, 3, 6, 10, 15, 21, 28, 37, 48, 61, 77, 97];

// --- reverse lookups (built once) ---
const PROFESSION_BY_NAME = new Map(PROFESSIONS.map((name, id) => [name.toLowerCase(), id]));
const ATTRIBUTE_BY_NAME = new Map(Object.entries(ATTRIBUTES).map(([id, name]) => [name.toLowerCase(), Number(id)]));
// Skill name -> id. Names are not unique; prefer the lowest (canonical) id and skip "(PvP)" variants.
const SKILL_BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(SKILL_NAMES)) {
  if (/\(PvP\)$/.test(name)) continue;
  const key = name.toLowerCase();
  const numeric = Number(id);
  if (!SKILL_BY_NAME.has(key) || numeric < (SKILL_BY_NAME.get(key) as number)) {
    SKILL_BY_NAME.set(key, numeric);
  }
}

export type SkillRef = string | number;
export type AttributeSpec = { attribute: SkillRef; points: number };

export type EncodeBuildSpec = {
  primary: SkillRef;
  secondary?: SkillRef;
  attributes?: AttributeSpec[];
  /** Up to 8 skills, by name or id. Missing slots are encoded as empty. */
  skills: SkillRef[];
};

export type BuildResources = {
  /** Total energy if every energy skill were used once. */
  totalEnergyCost: number;
  /**
   * Upper-bound sustained energy drain (energy/sec) if every energy skill is kept on recharge.
   * A theoretical ceiling, not a rotation simulation — real drain is lower.
   */
  maxSustainedEnergyPerSecond: number;
  /**
   * How the bar pays for itself:
   *   "light"          — low total energy, no concern
   *   "managed"        — carries its own energy management (energy gain / cost reduction)
   *   "adrenaline-based" — mostly adrenaline attacks, little energy reliance
   *   "needs-engine"   — energy-heavy with no on-bar management; relies on a primary-attribute
   *                      engine (Soul Reaping, Mysticism, Expertise…), an attunement, or a Zealous weapon
   */
  energyOutlook: "light" | "managed" | "adrenaline-based" | "needs-engine";
  energyManagementSkills: string[];
  adrenalineSkillCount: number;
  longestRechargeSeconds: number;
  hasResurrect: boolean;
  /** Whether the bar carries any self-heal / health-sustain (heal, health regen/gain, or life steal). */
  hasSelfSustain: boolean;
  selfSustainSkills: string[];
  /** Skills that sacrifice health to use (a health cost to budget against your sustain). */
  sacrificeSkills: string[];
  /** Skills with no listed numeric stats (e.g. unknown ids) — analysis is partial for these. */
  skillsMissingStats: string[];
};

export type BuildValidation = {
  legal: boolean;
  errors: string[];
  warnings: string[];
  elites: string[];
  pveOnly: string[];
  allegiances: string[];
  attributePointsSpent: number;
  attributePointBudget: number;
  /** Skills that have a separate (PvP) version whose values differ. */
  pvpSplit: string[];
  resources: BuildResources;
};

export type EncodeBuildResult = {
  code: string;
  decoded: DecodedSkillTemplate;
  validation: BuildValidation;
};

function resolveProfession(ref: SkillRef): number {
  if (typeof ref === "number") return ref;
  const id = PROFESSION_BY_NAME.get(ref.trim().toLowerCase());
  if (id === undefined) throw new Error(`Unknown profession: "${ref}"`);
  return id;
}

function resolveAttribute(ref: SkillRef): number {
  if (typeof ref === "number") return ref;
  const id = ATTRIBUTE_BY_NAME.get(ref.trim().toLowerCase());
  if (id === undefined) throw new Error(`Unknown attribute: "${ref}"`);
  return id;
}

function resolveSkill(ref: SkillRef): number {
  if (typeof ref === "number") return ref;
  const trimmed = ref.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "(empty)") return 0;
  const id = SKILL_BY_NAME.get(trimmed.toLowerCase());
  if (id === undefined) throw new Error(`Unknown skill: "${ref}"`);
  return id;
}

class BitWriter {
  private readonly bits: number[] = [];
  write(value: number, count: number): void {
    for (let i = 0; i < count; i += 1) this.bits.push((value >> i) & 1);
  }
  toBase64(): string {
    while (this.bits.length % 6 !== 0) this.bits.push(0);
    let out = "";
    for (let i = 0; i < this.bits.length; i += 6) {
      let value = 0;
      for (let j = 0; j < 6; j += 1) value |= this.bits[i + j] << j;
      out += BASE64_ALPHABET[value];
    }
    return out;
  }
}

function bitsFor(maxValue: number, min: number, step: number): number {
  let bits = min;
  while (1 << bits <= maxValue) bits += step;
  return bits;
}

/**
 * Encodes a skill build into a Guild Wars template code, then decodes and validates it.
 * Throws on unknown profession/attribute/skill names or more than 8 skills.
 */
export function encodeSkillTemplate(spec: EncodeBuildSpec): EncodeBuildResult {
  const primaryId = resolveProfession(spec.primary);
  const secondaryId = resolveProfession(spec.secondary ?? "None");
  const attributes = (spec.attributes ?? []).map((a) => ({ id: resolveAttribute(a.attribute), points: a.points }));
  const skillIds = spec.skills.map(resolveSkill);
  if (skillIds.length > 8) throw new Error(`A skill bar holds at most 8 skills (got ${skillIds.length}).`);
  while (skillIds.length < 8) skillIds.push(0);

  for (const a of attributes) {
    if (a.points < 0 || a.points > 12) throw new Error(`Attribute points must be 0-12 (got ${a.points}).`);
  }

  const bitsPerProfession = bitsFor(Math.max(primaryId, secondaryId, 1), 4, 2);
  const bitsPerAttribute = bitsFor(Math.max(0, ...attributes.map((a) => a.id)), 4, 1);
  const bitsPerSkill = bitsFor(Math.max(0, ...skillIds), 8, 1);

  const writer = new BitWriter();
  writer.write(SKILL_TEMPLATE_TYPE, 4);
  writer.write(0, 4); // version
  writer.write((bitsPerProfession - 4) / 2, 2);
  writer.write(primaryId, bitsPerProfession);
  writer.write(secondaryId, bitsPerProfession);
  writer.write(attributes.length, 4);
  writer.write(bitsPerAttribute - 4, 4);
  for (const a of attributes) {
    writer.write(a.id, bitsPerAttribute);
    writer.write(a.points, 4);
  }
  writer.write(bitsPerSkill - 8, 4);
  for (const id of skillIds) writer.write(id, bitsPerSkill);
  writer.write(0, 1); // mandatory tail bit

  const code = writer.toBase64();
  const decoded = decodeSkillTemplate(code);
  return { code, decoded, validation: validateBuild(decoded) };
}

function meta(id: number) {
  return SKILL_META[String(id)] ?? {};
}

function attributePointCost(rank: number): number {
  return ATTRIBUTE_POINT_COST[Math.max(0, Math.min(12, rank))] ?? 0;
}

/**
 * Validates a decoded build against Guild Wars build-construction rules.
 * Hard rules (errors): one elite max, three PvE-only skills max, single allegiance, 200 attribute-point budget.
 * Soft checks (warnings): missing elite, profession mismatch (metadata edge cases), PvE/PvP split skills.
 */
export function validateBuild(decoded: DecodedSkillTemplate): BuildValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const realSkills = decoded.skills.filter((s) => s.id > 0);

  const elites = realSkills.filter((s) => meta(s.id).e);
  if (elites.length > MAX_ELITES) {
    errors.push(`${elites.length} elite skills (${elites.map((s) => s.name).join(", ")}); a bar may hold at most ${MAX_ELITES}.`);
  } else if (elites.length === 0) {
    warnings.push("No elite skill equipped — legal, but usually a wasted slot.");
  }

  const pveOnly = realSkills.filter((s) => meta(s.id).v);
  if (pveOnly.length > MAX_PVE_ONLY) {
    errors.push(`${pveOnly.length} PvE-only skills (${pveOnly.map((s) => s.name).join(", ")}); the game allows at most ${MAX_PVE_ONLY}.`);
  }

  const allegiances: string[] = [];
  if (realSkills.some((s) => meta(s.id).k)) allegiances.push("Kurzick");
  if (realSkills.some((s) => meta(s.id).l)) allegiances.push("Luxon");
  if (allegiances.length > 1) {
    errors.push("Mixed allegiance skills (Kurzick + Luxon); only one allegiance may be equipped at a time.");
  }

  const attributePointsSpent = decoded.attributes.reduce((sum, a) => sum + attributePointCost(a.points), 0);
  if (attributePointsSpent > ATTRIBUTE_POINT_BUDGET) {
    errors.push(`Attribute spend ${attributePointsSpent} exceeds the ${ATTRIBUTE_POINT_BUDGET}-point budget.`);
  }

  const allowedProfessions = new Set([decoded.primary.id, decoded.secondary.id, 0]);
  for (const s of realSkills) {
    const p = meta(s.id).p;
    if (p !== undefined && !allowedProfessions.has(p)) {
      warnings.push(`${s.name} is a ${PROFESSIONS[p] ?? `profession ${p}`} skill, not usable by ${decoded.primary.name}/${decoded.secondary.name}.`);
    }
  }

  const pvpSplit = realSkills.filter((s) => meta(s.id).x).map((s) => s.name);
  if (pvpSplit.length > 0) {
    warnings.push(`These skills have a separate (PvP) version with different values: ${pvpSplit.join(", ")}.`);
  }

  const resources = analyzeResources(realSkills);
  if (resources.energyOutlook === "needs-engine") {
    warnings.push(
      `Energy-heavy (${resources.totalEnergyCost}e total, ~${resources.maxSustainedEnergyPerSecond} e/s if spammed) with no energy-management skill on the bar. It relies on a primary-attribute engine (e.g. Soul Reaping, Mysticism cost reduction, Expertise), an attunement, or a Zealous weapon — make sure you have one.`
    );
  }
  if (!resources.hasResurrect) {
    warnings.push("No resurrection skill on the bar — fine if a teammate or hero carries one, otherwise consider adding a rez.");
  }
  if (!resources.hasSelfSustain) {
    warnings.push("No self-heal or health-sustain on the bar — relies entirely on party/hero healers to stay alive.");
  }
  if (resources.sacrificeSkills.length > 0 && !resources.hasSelfSustain) {
    warnings.push(`Sacrifices health (${resources.sacrificeSkills.join(", ")}) with no self-sustain — pair with healing or Soul Reaping to avoid bleeding out.`);
  }
  if (resources.skillsMissingStats.length > 0) {
    warnings.push(`Energy/recharge analysis is partial — no numeric stats for: ${resources.skillsMissingStats.join(", ")}.`);
  }

  return {
    legal: errors.length === 0,
    errors,
    warnings,
    elites: elites.map((s) => s.name),
    pveOnly: pveOnly.map((s) => s.name),
    allegiances,
    attributePointsSpent,
    attributePointBudget: ATTRIBUTE_POINT_BUDGET,
    pvpSplit,
    resources
  };
}

const ENERGY_PER_PIP = 0.33;

function analyzeResources(realSkills: { id: number; name: string }[]): BuildResources {
  let totalEnergyCost = 0;
  let drain = 0;
  let adrenalineSkillCount = 0;
  let longestRechargeSeconds = 0;
  let hasResurrect = false;
  const energyManagementSkills: string[] = [];
  const selfSustainSkills: string[] = [];
  const sacrificeSkills: string[] = [];
  const skillsMissingStats: string[] = [];

  for (const s of realSkills) {
    const m = meta(s.id);
    if (m.rz) hasResurrect = true;
    if (m.em) energyManagementSkills.push(s.name);
    if (m.hl) selfSustainSkills.push(s.name);
    if (m.sac) sacrificeSkills.push(s.name);
    if (m.ad) adrenalineSkillCount += 1;
    if (m.en) totalEnergyCost += m.en;
    if (m.re && m.re > longestRechargeSeconds) longestRechargeSeconds = m.re;
    // sustained drain ceiling: each energy skill kept on recharge, plus upkeep degen.
    if (m.en && m.re && m.re > 0) drain += m.en / m.re;
    if (m.up && m.up < 0) drain += Math.abs(m.up) * ENERGY_PER_PIP;
    if (m.en === undefined && m.ad === undefined && m.re === undefined && m.ac === undefined) {
      skillsMissingStats.push(s.name);
    }
  }

  const maxSustainedEnergyPerSecond = Math.round(drain * 100) / 100;
  let energyOutlook: BuildResources["energyOutlook"];
  if (totalEnergyCost <= 20) energyOutlook = "light";
  else if (energyManagementSkills.length > 0) energyOutlook = "managed";
  else if (adrenalineSkillCount >= 3 && totalEnergyCost <= 45) energyOutlook = "adrenaline-based";
  else energyOutlook = "needs-engine";

  return {
    totalEnergyCost,
    maxSustainedEnergyPerSecond,
    energyOutlook,
    energyManagementSkills,
    adrenalineSkillCount,
    longestRechargeSeconds,
    hasResurrect,
    hasSelfSustain: selfSustainSkills.length > 0,
    selfSustainSkills,
    sacrificeSkills,
    skillsMissingStats
  };
}
