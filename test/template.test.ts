import { describe, expect, it } from "vitest";
import { analyzeTemplateCode, decodeSkillTemplate, extractTemplateCode } from "../src/template.js";

describe("template code analysis", () => {
  it("extracts a code from a GW1 Builds URL", () => {
    expect(extractTemplateCode("https://gw1builds.com/b/-DXCoJ5?template=OApjYwp4qSaXPXBYZXmXf1bhqiA")).toBe("OApjYwp4qSaXPXBYZXmXf1bhqiA");
  });

  it("classifies plausible skill template codes", () => {
    const analysis = analyzeTemplateCode("OApjYwp4qSaXPXBYZXmXf1bhqiA");

    expect(analysis.plausible).toBe(true);
    expect(analysis.kind).toBe("skill");
    expect(analysis.validCharacters).toBe(true);
    expect(analysis.referenceUrls).toContain("https://wiki.guildwars.com/wiki/Skill_template_format");
  });

  it("flags invalid codes", () => {
    const analysis = analyzeTemplateCode("not a template!");

    expect(analysis.plausible).toBe(false);
    expect(analysis.warnings.length).toBeGreaterThan(0);
  });
});

describe("skill template decoding", () => {
  it("fully decodes a skill template into professions, attributes, and skills", () => {
    const decoded = decodeSkillTemplate("OApjYwp4qSaXPXBYZXmXf1bhqiA");

    expect(decoded.templateType).toBe(14);
    expect(decoded.version).toBe(0);
    expect(decoded.primary.name).toBe("Necromancer");
    expect(decoded.secondary.name).toBe("Dervish");
    expect(decoded.attributes).toEqual([
      { id: 6, name: "Soul Reaping", points: 12 },
      { id: 41, name: "Scythe Mastery", points: 8 },
      { id: 43, name: "Earth Prayers", points: 10 }
    ]);
    expect(decoded.skillIds).toHaveLength(8);
    expect(decoded.trailingBitOk).toBe(true);
  });

  it("resolves skill ids to wiki skill names", () => {
    const decoded = decodeSkillTemplate("OApjYwp4qSaXPXBYZXmXf1bhqiA");

    expect(decoded.skills).toHaveLength(8);
    expect(decoded.skills.every((skill) => skill.resolved)).toBe(true);
    expect(decoded.skills.map((skill) => skill.name)).toEqual([
      "Staggering Force",
      "Twin Moon Sweep",
      "Wearying Strike",
      "Dust Cloak",
      "Sand Shards",
      "Soul Taker",
      "Masochism",
      "Drunken Master"
    ]);
  });

  it("surfaces the decoded template through analyzeTemplateCode", () => {
    const analysis = analyzeTemplateCode("OApjYwp4qSaXPXBYZXmXf1bhqiA");

    expect(analysis.decoded?.primary.name).toBe("Necromancer");
    expect(analysis.decodeError).toBeUndefined();
  });

  it("reports a decode error for a truncated skill code without throwing", () => {
    // Wiki's own example that is missing its final skill when re-encoded.
    const analysis = analyzeTemplateCode("OAhiYwhMVzUVxJKNN5MMtFmc");

    expect(analysis.decoded).toBeUndefined();
    expect(analysis.decodeError).toBeDefined();
    expect(analysis.warnings.some((w) => w.includes("could not be fully decoded"))).toBe(true);
  });
});
