import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { executeSearch } from "../../search/execute";
import { search as runSearch } from "../../search/v2";
import { planAutomaticSearchQueries } from "../../search/query-plan";

jest.mock("../../search/v2", () => ({
  search: jest.fn(),
}));

jest.mock("../../search/query-plan", () => ({
  ...(jest.requireActual("../../search/query-plan") as object),
  planAutomaticSearchQueries: jest.fn(),
}));

jest.mock("../../search/scrape", () => ({
  getItemsToScrape: jest.fn(() => []),
  scrapeSearchResults: jest.fn(),
  mergeScrapedContent: jest.fn(),
  calculateScrapeCredits: jest.fn(() => 0),
}));

const searchMock = runSearch as jest.MockedFunction<typeof runSearch>;
const queryPlannerMock = planAutomaticSearchQueries as jest.MockedFunction<
  typeof planAutomaticSearchQueries
>;

function createLogger() {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  } as any;

  logger.child.mockReturnValue(logger);

  return logger;
}

describe("executeSearch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns grouped and deduped results for batch query mode", async () => {
    searchMock.mockImplementation(async ({ query }) => {
      if (query === "alpha") {
        return {
          web: [
            {
              url: "https://example.com/a1",
              title: "Alpha One",
              description: "alpha one",
            },
            {
              url: "https://example.com/shared",
              title: "Shared",
              description: "shared result",
            },
            {
              url: "https://example.com/overflow",
              title: "Overflow",
              description: "overflow result",
            },
          ],
        };
      }

      return {
        web: [
          {
            url: "https://example.com/shared",
            title: "Shared",
            description: "shared result",
          },
          {
            url: "https://example.com/b1",
            title: "Beta One",
            description: "beta one",
          },
        ],
      };
    });

    const result = await executeSearch(
      {
        query: ["alpha", "beta"],
        limit: 10,
        resultsPerQuery: 2,
        sources: [{ type: "web" }],
        timeout: 60_000,
      },
      {
        teamId: "team_123",
        origin: "api",
        apiKeyId: null,
        flags: null as any,
        requestId: "request_123",
      },
      createLogger(),
    );

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(result.response.queryPlan?.mode).toBe("batch");
    expect(result.response.queryPlan?.resultsPerQuery).toBe(2);
    expect(result.response.queryPlan?.searches).toHaveLength(2);
    expect(result.response.queryPlan?.searches[0].web).toHaveLength(2);
    expect(result.response.queryPlan?.searches[1].web).toHaveLength(2);
    expect(result.response.web).toHaveLength(3);
    expect(result.totalResultsCount).toBe(4);
    expect(result.searchCredits).toBe(2);
  });

  it("uses the auto query planner when query decomposition is enabled", async () => {
    queryPlannerMock.mockResolvedValue([
      {
        query: "topic overview",
        goal: "Find the broad answer",
      },
      {
        query: "topic pricing",
        goal: "Find pricing specifics",
      },
    ]);

    searchMock.mockImplementation(async ({ query }) => ({
      web: [
        {
          url: `https://example.com/${encodeURIComponent(query)}`,
          title: String(query),
          description: "result",
        },
      ],
    }));

    const result = await executeSearch(
      {
        query: "topic",
        limit: 10,
        resultsPerQuery: 1,
        queryDecomposition: {
          mode: "auto",
          maxQueries: 2,
        },
        sources: [{ type: "web" }],
        timeout: 60_000,
      },
      {
        teamId: "team_123",
        origin: "api",
        apiKeyId: null,
        flags: null as any,
        requestId: "request_123",
      },
      createLogger(),
    );

    expect(queryPlannerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "topic",
        maxQueries: 2,
      }),
    );
    expect(result.response.queryPlan?.mode).toBe("auto");
    expect(result.response.queryPlan?.originalQuery).toBe("topic");
    expect(result.response.queryPlan?.searches[0].goal).toBe(
      "Find the broad answer",
    );
    expect(result.response.web).toHaveLength(2);
    expect(result.totalResultsCount).toBe(2);
  });
});
