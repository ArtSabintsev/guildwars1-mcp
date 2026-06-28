import { describe, expect, it } from "vitest";
import { analyzeTemplateCode, extractTemplateCode } from "../src/template.js";

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
