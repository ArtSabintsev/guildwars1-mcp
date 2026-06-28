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
  referenceUrls: string[];
};

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

  return {
    input,
    code,
    validCharacters,
    plausible: validCharacters && code.length >= 8 && kind !== "unknown",
    kind,
    length: code.length,
    normalizedAlphabet,
    warnings,
    referenceUrls: [
      wikiPageUrl("gww", "Skill template format"),
      wikiPageUrl("gww", "Equipment template format"),
      wikiPageUrl("gww", "Skill template format/Skill list")
    ]
  };
}
