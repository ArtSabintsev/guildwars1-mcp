import { SKILL_INDEX_SOURCE, SKILL_META, SKILL_NAMES } from "./skills.generated.js";
import { wikiPageUrl } from "./sources.js";

export type TemplateCodeAnalysis = {
  input: string;
  code: string;
  validCharacters: boolean;
  plausible: boolean;
  kind: "skill" | "equipment" | "unknown";
  length: number;
  normalizedAlphabet: "base64url-ish" | "contains-standard-base64" | "unknown";
  warnings: string[];
  decoded?: DecodedSkillTemplate;
  decodeError?: string;
  referenceUrls: string[];
};

export type DecodedAttribute = {
  id: number;
  name: string;
  points: number;
};

export type DecodedSkill = {
  id: number;
  /** Canonical Guild Wars Wiki skill name, "(empty)" for an empty slot, or "Skill <id>" if unknown. */
  name: string;
  resolved: boolean;
  /** Link to the skill's Guild Wars Wiki page (human-written description), when resolved. */
  wikiUrl?: string;
  /** Energy cost, in points. */
  energy?: number;
  /** Activation (cast) time, in seconds. */
  cast?: number;
  /** Recharge time, in seconds. */
  recharge?: number;
  /** Adrenaline cost, in strikes. */
  adrenaline?: number;
};

export type DecodedSkillTemplate = {
  templateType: number | null;
  version: number;
  primary: { id: number; name: string };
  secondary: { id: number; name: string };
  attributes: DecodedAttribute[];
  /** Eight skill slots resolved to names via the bundled wiki skill index. */
  skills: DecodedSkill[];
  /** Eight raw skill ids; 0 means an empty slot. */
  skillIds: number[];
  bitsPerProfession: number;
  bitsPerAttribute: number;
  bitsPerSkill: number;
  trailingBitOk: boolean;
};

// Standard Base64 alphabet used by Guild Wars template codes.
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Profession index per https://wiki.guildwars.com/wiki/Skill_template_format
export const PROFESSIONS = [
  "None",
  "Warrior",
  "Ranger",
  "Monk",
  "Necromancer",
  "Mesmer",
  "Elementalist",
  "Assassin",
  "Ritualist",
  "Paragon",
  "Dervish"
] as const;

// Attribute index per https://wiki.guildwars.com/wiki/Skill_template_format (note the gaps at 26-28).
export const ATTRIBUTES: Record<number, string> = {
  0: "Fast Casting",
  1: "Illusion Magic",
  2: "Domination Magic",
  3: "Inspiration Magic",
  4: "Blood Magic",
  5: "Death Magic",
  6: "Soul Reaping",
  7: "Curses",
  8: "Air Magic",
  9: "Earth Magic",
  10: "Fire Magic",
  11: "Water Magic",
  12: "Energy Storage",
  13: "Healing Prayers",
  14: "Smiting Prayers",
  15: "Protection Prayers",
  16: "Divine Favor",
  17: "Strength",
  18: "Axe Mastery",
  19: "Hammer Mastery",
  20: "Swordsmanship",
  21: "Tactics",
  22: "Beast Mastery",
  23: "Expertise",
  24: "Wilderness Survival",
  25: "Marksmanship",
  29: "Dagger Mastery",
  30: "Deadly Arts",
  31: "Shadow Arts",
  32: "Communing",
  33: "Restoration Magic",
  34: "Channeling Magic",
  35: "Critical Strikes",
  36: "Spawning Power",
  37: "Spear Mastery",
  38: "Command",
  39: "Motivation",
  40: "Leadership",
  41: "Scythe Mastery",
  42: "Wind Prayers",
  43: "Earth Prayers",
  44: "Mysticism"
};

const SKILL_TEMPLATE_TYPE = 14;

function professionName(id: number): string {
  return PROFESSIONS[id] ?? `Unknown (${id})`;
}

function attributeName(id: number): string {
  return ATTRIBUTES[id] ?? `Unknown (${id})`;
}

function resolveSkill(id: number): DecodedSkill {
  if (id === 0) {
    return { id, name: "(empty)", resolved: true };
  }
  const name = SKILL_NAMES[String(id)];
  if (!name) {
    return { id, name: `Skill ${id}`, resolved: false };
  }
  const m = SKILL_META[String(id)] ?? {};
  return {
    id,
    name,
    resolved: true,
    wikiUrl: wikiPageUrl("gww", name),
    ...(m.en !== undefined ? { energy: m.en } : {}),
    ...(m.ac !== undefined ? { cast: m.ac } : {}),
    ...(m.re !== undefined ? { recharge: m.re } : {}),
    ...(m.ad !== undefined ? { adrenaline: m.ad } : {})
  };
}

/**
 * Reads a little-endian (lowest-bit-first) stream of base64-encoded 6-bit groups,
 * as specified by the Guild Wars skill template format.
 */
class BitReader {
  private readonly bits: number[];
  private pos = 0;

  constructor(code: string) {
    const bits: number[] = [];
    for (const ch of code) {
      const value = BASE64_ALPHABET.indexOf(ch);
      if (value < 0) {
        throw new Error(`Invalid template character: "${ch}"`);
      }
      for (let i = 0; i < 6; i += 1) {
        bits.push((value >> i) & 1);
      }
    }
    this.bits = bits;
  }

  read(n: number): number {
    if (this.pos + n > this.bits.length) {
      throw new Error("Template ended before all fields were read.");
    }
    let value = 0;
    for (let i = 0; i < n; i += 1) {
      value |= this.bits[this.pos] << i;
      this.pos += 1;
    }
    return value;
  }

  remaining(): number {
    return this.bits.length - this.pos;
  }
}

/**
 * Fully decodes a Guild Wars skill template code into professions, attributes, and skill ids.
 * Throws if the code is not a valid skill template. Skill-id → name resolution requires the
 * separate skill dataset and is intentionally not performed here.
 */
export function decodeSkillTemplate(input: string): DecodedSkillTemplate {
  const code = extractTemplateCode(input);
  const reader = new BitReader(code);

  // Type/version header. Post-2007 templates lead with a 4-bit type of 14 (0xE).
  // Pre-2007 templates omit the type and begin directly with the version nibble.
  const first = reader.read(4);
  let templateType: number | null;
  let version: number;
  if (first === SKILL_TEMPLATE_TYPE) {
    templateType = SKILL_TEMPLATE_TYPE;
    version = reader.read(4);
  } else {
    templateType = null;
    version = first;
  }

  const bitsPerProfession = reader.read(2) * 2 + 4;
  const primaryId = reader.read(bitsPerProfession);
  const secondaryId = reader.read(bitsPerProfession);

  const attributeCount = reader.read(4);
  const bitsPerAttribute = reader.read(4) + 4;
  const attributes: DecodedAttribute[] = [];
  for (let i = 0; i < attributeCount; i += 1) {
    const id = reader.read(bitsPerAttribute);
    const points = reader.read(4);
    attributes.push({ id, name: attributeName(id), points });
  }

  const bitsPerSkill = reader.read(4) + 8;
  const skillIds: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    skillIds.push(reader.read(bitsPerSkill));
  }

  // Tail: a single mandatory zero bit. Tolerate its absence in truncated codes.
  const trailingBitOk = reader.remaining() === 0 ? true : reader.read(1) === 0;

  return {
    templateType,
    version,
    primary: { id: primaryId, name: professionName(primaryId) },
    secondary: { id: secondaryId, name: professionName(secondaryId) },
    attributes,
    skills: skillIds.map(resolveSkill),
    skillIds,
    bitsPerProfession,
    bitsPerAttribute,
    bitsPerSkill,
    trailingBitOk
  };
}

const CODE_URL_PATTERNS = [
  /[?&](?:template|code|build)=([A-Za-z0-9+/_=-]+)/i,
  /\/(?:b|build)\/([A-Za-z0-9+/_=-]+)/i
];

export function extractTemplateCode(input: string): string {
  const trimmed = input.trim();
  for (const pattern of CODE_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return trimmed.replace(/\s+/g, "");
}

export function analyzeTemplateCode(input: string): TemplateCodeAnalysis {
  const code = extractTemplateCode(input);
  const validCharacters = /^[A-Za-z0-9+/_=-]+$/.test(code);
  const warnings: string[] = [];

  if (code.length < 8) {
    warnings.push("Template code is shorter than expected.");
  }
  if (!validCharacters) {
    warnings.push("Template code contains characters outside the expected Guild Wars template alphabet.");
  }

  const first = code[0]?.toUpperCase();
  const kind = first === "O" ? "skill" : first === "P" ? "equipment" : "unknown";
  if (kind === "unknown") {
    warnings.push("Template kind is unknown. Skill templates commonly start with O; equipment templates commonly start with P.");
  }

  const normalizedAlphabet = /[+\/=]/.test(code)
    ? "contains-standard-base64"
    : /^[A-Za-z0-9_-]+$/.test(code)
      ? "base64url-ish"
      : "unknown";

  let decoded: DecodedSkillTemplate | undefined;
  let decodeError: string | undefined;
  if (kind === "skill" && validCharacters) {
    try {
      decoded = decodeSkillTemplate(code);
      if (!decoded.trailingBitOk) {
        warnings.push("Trailing tail bit was not zero; the code may be truncated or malformed.");
      }
    } catch (error) {
      decodeError = error instanceof Error ? error.message : String(error);
      warnings.push(`Skill template could not be fully decoded: ${decodeError}`);
    }
  }

  return {
    input,
    code,
    validCharacters,
    plausible: validCharacters && code.length >= 8 && kind !== "unknown",
    kind,
    length: code.length,
    normalizedAlphabet,
    warnings,
    decoded,
    decodeError,
    referenceUrls: [
      wikiPageUrl("gww", "Skill template format"),
      wikiPageUrl("gww", "Equipment template format"),
      wikiPageUrl("gww", "Skill template format/Skill list"),
      SKILL_INDEX_SOURCE
    ]
  };
}
