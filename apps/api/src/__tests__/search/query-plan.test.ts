import { describe, expect, it } from "@jest/globals";
import { buildFallbackSearchQueries } from "../../search/query-plan";

describe("query-plan", () => {
  it("builds deterministic fallback queries with the original query first", () => {
    const plannedSearches = buildFallbackSearchQueries("firecrawl search", 4);

    expect(plannedSearches).toHaveLength(4);
    expect(plannedSearches[0].query).toBe("firecrawl search");
    expect(new Set(plannedSearches.map(search => search.query)).size).toBe(4);
  });
});
