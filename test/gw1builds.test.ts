import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../src/http.js";
import { searchGw1Builds } from "../src/gw1builds.js";

vi.mock("../src/http.js", () => ({
  fetchJson: vi.fn()
}));

const mockedFetchJson = vi.mocked(fetchJson);

describe("GW1 Builds search", () => {
  beforeEach(() => {
    mockedFetchJson.mockReset();
  });

  it("filters builds and omits authors by default", async () => {
    mockedFetchJson.mockResolvedValue({
      nextOffset: null,
      builds: [
        {
          id: "-DXCoJ5",
          name: "Soul Taker MCway",
          tags: ["pve", "meta"],
          author: "public-handle",
          bars: [
            {
              name: "Soul Taker",
              primary: "Necromancer",
              secondary: "Warrior",
              template: "OApjYwp4qSaXPXBYZXmXf1bhqiA",
              skills: [1498, 1487]
            }
          ]
        },
        {
          id: "abc",
          name: "Unrelated",
          tags: ["pvp"],
          author: "another-handle",
          bars: []
        }
      ]
    });

    const search = await searchGw1Builds({ query: "soul", limit: 5 });

    expect(search.results).toHaveLength(1);
    expect(search.results[0]?.name).toBe("Soul Taker MCway");
    expect(search.results[0]).not.toHaveProperty("author");
    expect(search.results[0]?.bars[0]?.skillIds).toEqual([1498, 1487]);
  });

  it("includes authors only when explicitly requested", async () => {
    mockedFetchJson.mockResolvedValue({
      nextOffset: null,
      builds: [{ id: "x", name: "Build", tags: [], author: "public-handle", bars: [] }]
    });

    const search = await searchGw1Builds({ includeAuthors: true });

    expect(search.results[0]?.author).toBe("public-handle");
  });
});
