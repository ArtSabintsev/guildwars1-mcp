import { describe, expect, it } from "vitest";
import { encodeSkillTemplate, validateBuild } from "../src/build.js";
import { decodeSkillTemplate } from "../src/template.js";

describe("encodeSkillTemplate", () => {
  it("encodes a legal build to an importable code that decodes back exactly", () => {
    const result = encodeSkillTemplate({
      primary: "Dervish",
      secondary: "Warrior",
      attributes: [
        { attribute: "Axe Mastery", points: 12 },
        { attribute: "Wind Prayers", points: 9 },
        { attribute: "Mysticism", points: 9 }
      ],
      skills: ["Onslaught", "Dismember", "Executioner's Strike", "Cyclone Axe", "Aura Slicer", '"For Great Justice!"', '"I Am Unstoppable!"', "Drunken Master"]
    });

    expect(result.validation.legal).toBe(true);
    expect(result.validation.elites).toEqual(["Onslaught"]);
    expect(result.decoded.primary.name).toBe("Dervish");
    // round-trip: decoding the produced code yields the same skills
    const redecoded = decodeSkillTemplate(result.code);
    expect(redecoded.skills.map((s) => s.name)).toEqual(result.decoded.skills.map((s) => s.name));
  });

  it("pads missing skill slots with empty and rejects unknown names", () => {
    const padded = encodeSkillTemplate({ primary: "Warrior", attributes: [{ attribute: "Swordsmanship", points: 12 }], skills: ["Hundred Blades"] });
    expect(padded.decoded.skillIds).toHaveLength(8);
    expect(padded.decoded.skillIds.filter((id) => id === 0).length).toBe(7);

    expect(() => encodeSkillTemplate({ primary: "Warrior", skills: ["Definitely Not A Skill"] })).toThrow(/Unknown skill/);
  });
});

describe("validateBuild rules", () => {
  const build = (overrides: Parameters<typeof encodeSkillTemplate>[0]) => encodeSkillTemplate(overrides).validation;

  it("rejects two elite skills", () => {
    const v = build({ primary: "Monk", attributes: [{ attribute: "Smiting Prayers", points: 12 }], skills: ["Ray of Judgment", "Signet of Judgment", "Resurrection Signet"] });
    expect(v.legal).toBe(false);
    expect(v.errors.some((e) => /elite/i.test(e))).toBe(true);
  });

  it("rejects more than three PvE-only skills", () => {
    const v = build({ primary: "Warrior", attributes: [{ attribute: "Swordsmanship", points: 12 }], skills: ["Hundred Blades", "Whirlwind Attack", "Drunken Master", '"I Am Unstoppable!"', "Sunspear Rebirth Signet"] });
    expect(v.legal).toBe(false);
    expect(v.errors.some((e) => /PvE-only/.test(e))).toBe(true);
  });

  it("rejects an over-budget attribute spread", () => {
    // 12 + 12 + 12 = 97*3 = 291 points, over the 200 budget
    const v = build({ primary: "Elementalist", attributes: [{ attribute: "Fire Magic", points: 12 }, { attribute: "Energy Storage", points: 12 }, { attribute: "Water Magic", points: 12 }], skills: ["Searing Flames"] });
    expect(v.legal).toBe(false);
    expect(v.attributePointsSpent).toBeGreaterThan(200);
    expect(v.errors.some((e) => /budget/.test(e))).toBe(true);
  });

  it("flags PvE/PvP split skills as a warning without making the build illegal", () => {
    const v = build({ primary: "Dervish", attributes: [{ attribute: "Scythe Mastery", points: 12 }], skills: ["Wounding Strike"] });
    expect(v.pvpSplit).toContain("Wounding Strike");
    expect(v.legal).toBe(true);
  });

  it("reports accurate energy outlook and per-skill costs", () => {
    const result = encodeSkillTemplate({
      primary: "Elementalist",
      secondary: "Mesmer",
      attributes: [{ attribute: "Fire Magic", points: 12 }, { attribute: "Energy Storage", points: 12 }],
      skills: ["Searing Flames", "Glowing Gaze", "Liquid Flame", "Mark of Rodgort", "Fire Attunement", "Glyph of Lesser Energy", "Meteor Shower", "Resurrection Signet"]
    });

    // per-skill costs are attached to the decoded bar
    const searing = result.decoded.skills.find((s) => s.name === "Searing Flames");
    expect(searing?.energy).toBe(15);
    expect(searing?.recharge).toBe(2);

    // self-managed: detects its own energy management, so it is NOT flagged as energy-hungry
    expect(result.validation.resources.energyOutlook).toBe("managed");
    expect(result.validation.resources.energyManagementSkills).toContain("Fire Attunement");
    expect(result.validation.warnings.some((w) => /Energy-heavy/.test(w))).toBe(false);
    expect(result.validation.resources.hasResurrect).toBe(true);
  });

  it("flags an energy-heavy bar that lacks on-bar energy management", () => {
    const v = build({
      primary: "Dervish",
      attributes: [{ attribute: "Scythe Mastery", points: 12 }, { attribute: "Earth Prayers", points: 10 }, { attribute: "Mysticism", points: 8 }],
      skills: ["Vow of Strength", "Eremite's Attack", "Mystic Sweep", "Reaper's Sweep", "Sand Shards", "Staggering Force", "Mystic Regeneration", '"I Am Unstoppable!"']
    });
    expect(v.resources.energyManagementSkills).toEqual([]);
    expect(v.resources.energyOutlook).toBe("needs-engine");
    expect(v.warnings.some((w) => /Energy-heavy/.test(w))).toBe(true);
  });

  it("detects health self-sustain and flags bars that lack it", () => {
    const sustained = build({
      primary: "Dervish",
      attributes: [{ attribute: "Scythe Mastery", points: 12 }, { attribute: "Earth Prayers", points: 8 }, { attribute: "Mysticism", points: 10 }],
      skills: ["Wounding Strike", "Eremite's Attack", "Mystic Regeneration", "Heart of Fury"]
    });
    expect(sustained.resources.hasSelfSustain).toBe(true);
    expect(sustained.resources.selfSustainSkills).toContain("Mystic Regeneration");
    expect(sustained.warnings.some((w) => /self-heal/.test(w))).toBe(false);

    const glassy = build({
      primary: "Mesmer",
      secondary: "Necromancer",
      attributes: [{ attribute: "Domination Magic", points: 12 }],
      skills: ["Energy Surge", "Cry of Frustration", "Power Drain", "Resurrection Signet"]
    });
    expect(glassy.resources.hasSelfSustain).toBe(false);
    expect(glassy.warnings.some((w) => /self-heal/.test(w))).toBe(true);
  });

  it("accepts a clean legal build", () => {
    const v = build({ primary: "Elementalist", secondary: "Mesmer", attributes: [{ attribute: "Fire Magic", points: 12 }, { attribute: "Energy Storage", points: 12 }], skills: ["Searing Flames", "Glowing Gaze", "Mark of Rodgort", "Fire Attunement", "Resurrection Signet"] });
    expect(v.legal).toBe(true);
    expect(v.errors).toEqual([]);
  });
});
