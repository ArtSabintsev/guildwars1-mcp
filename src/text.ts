import * as cheerio from "cheerio";

export function stripHtml(input: string): string {
  const $ = cheerio.load(input);
  return normalizeWhitespace($.root().text());
}

export function extractTextFromHtml(input: string): string {
  const $ = cheerio.load(input);
  $("script, style, noscript").remove();
  return normalizeWhitespace($("body").text() || $.root().text());
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function truncateText(input: string, maxCharacters: number): string {
  if (input.length <= maxCharacters) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}
