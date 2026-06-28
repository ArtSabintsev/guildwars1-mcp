import { describe, expect, it } from "vitest";
import { parseRedditAtom } from "../src/reddit.js";

const feed = `
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Guild Wars Reforged build question</title>
      <id>t3_test</id>
      <updated>2026-06-28T12:00:00+00:00</updated>
      <link rel="alternate" href="https://www.reddit.com/r/GuildWars/comments/test/post/" />
      <author><name>/u/example</name></author>
      <content type="html">&lt;div&gt;Looking for a Mesmer bar.&lt;/div&gt;</content>
    </entry>
  </feed>
`;

describe("Reddit Atom parsing", () => {
  it("parses entries and omits authors by default", () => {
    const results = parseRedditAtom(feed);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Guild Wars Reforged build question");
    expect(results[0]?.summary).toBe("Looking for a Mesmer bar.");
    expect(results[0]).not.toHaveProperty("author");
  });

  it("includes authors only when explicitly requested", () => {
    const results = parseRedditAtom(feed, { includeAuthors: true });

    expect(results[0]?.author).toBe("/u/example");
  });
});
