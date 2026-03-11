import type { Logger } from "winston";
import { search } from "./v2";
import {
  SearchQueryPlan,
  SearchQueryPlanSearch,
  SearchV2Response,
} from "../lib/entities";
import {
  buildSearchQuery,
  getCategoryFromUrl,
  CategoryOption,
} from "../lib/search-query-builder";
import { ScrapeOptions, TeamFlags } from "../controllers/v2/types";
import {
  getItemsToScrape,
  scrapeSearchResults,
  mergeScrapedContent,
  calculateScrapeCredits,
} from "./scrape";
import { PlannedSearch, planAutomaticSearchQueries } from "./query-plan";

interface SearchOptions {
  query: string | string[];
  limit: number;
  resultsPerQuery: number;
  queryDecomposition?: {
    mode: "auto";
    maxQueries: number;
  };
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  sources: Array<{ type: string }>;
  categories?: CategoryOption[];
  enterprise?: ("default" | "anon" | "zdr")[];
  scrapeOptions?: ScrapeOptions;
  timeout: number;
}

interface SearchContext {
  teamId: string;
  origin: string;
  apiKeyId: number | null;
  flags: TeamFlags;
  requestId: string;
  bypassBilling?: boolean;
  zeroDataRetention?: boolean;
}

interface SearchExecuteResult {
  response: SearchV2Response;
  totalResultsCount: number;
  searchCredits: number;
  scrapeCredits: number;
  totalCredits: number;
  shouldScrape: boolean;
}

type SearchSourceType = "web" | "images" | "news";

function countSearchResults(response: SearchV2Response): number {
  return (
    (response.web?.length ?? 0) +
    (response.images?.length ?? 0) +
    (response.news?.length ?? 0)
  );
}

function sliceSearchResponse(
  response: SearchV2Response,
  limit: number,
): SearchV2Response {
  const sliced: SearchV2Response = {};

  if (response.web?.length) {
    sliced.web = response.web.slice(0, limit);
  }

  if (response.images?.length) {
    sliced.images = response.images.slice(0, limit);
  }

  if (response.news?.length) {
    sliced.news = response.news.slice(0, limit);
  }

  return sliced;
}

function getSearchResultKey(
  sourceType: SearchSourceType,
  item: Record<string, any>,
): string | undefined {
  if (sourceType === "images") {
    return item.url ?? item.imageUrl;
  }

  return item.url;
}

function dedupeResults<T extends Record<string, any>>(
  items: T[] | undefined,
  sourceType: SearchSourceType,
): T[] | undefined {
  if (!items?.length) {
    return undefined;
  }

  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = getSearchResultKey(sourceType, item) ?? JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.length > 0 ? deduped : undefined;
}

function aggregateSearchResponses(
  responses: SearchV2Response[],
): SearchV2Response {
  return {
    web: dedupeResults(
      responses.flatMap(response => response.web ?? []),
      "web",
    ),
    images: dedupeResults(
      responses.flatMap(response => response.images ?? []),
      "images",
    ),
    news: dedupeResults(
      responses.flatMap(response => response.news ?? []),
      "news",
    ),
  };
}

function applyCategoryLabels(
  searchResponse: SearchV2Response,
  categoryMap: Map<string, string>,
): SearchV2Response {
  if (searchResponse.web?.length) {
    searchResponse.web = searchResponse.web.map(result => ({
      ...result,
      category: getCategoryFromUrl(result.url, categoryMap),
    }));
  }

  if (searchResponse.news?.length) {
    searchResponse.news = searchResponse.news.map(result => ({
      ...result,
      category: result.url
        ? getCategoryFromUrl(result.url, categoryMap)
        : undefined,
    }));
  }

  return searchResponse;
}

function buildQueryPlan(
  mode: SearchQueryPlan["mode"],
  originalQuery: string | undefined,
  resultsPerQuery: number,
  searches: SearchQueryPlanSearch[],
): SearchQueryPlan {
  return {
    mode,
    originalQuery,
    resultsPerQuery,
    searches,
  };
}

function propagateScrapedContentToQueryPlan(
  queryPlan: SearchQueryPlan,
  aggregateResponse: SearchV2Response,
): void {
  const webMap = new Map(
    (aggregateResponse.web ?? []).map(item => [item.url, item]),
  );
  const newsMap = new Map(
    (aggregateResponse.news ?? [])
      .filter(item => item.url)
      .map(item => [item.url!, item]),
  );
  const imageMap = new Map(
    (aggregateResponse.images ?? [])
      .filter(item => item.url || item.imageUrl)
      .map(item => [item.url ?? item.imageUrl!, item]),
  );

  queryPlan.searches = queryPlan.searches.map(searchGroup => ({
    ...searchGroup,
    web: searchGroup.web?.map(item => webMap.get(item.url) ?? item),
    news: searchGroup.news?.map(item =>
      item.url ? (newsMap.get(item.url) ?? item) : item,
    ),
    images: searchGroup.images?.map(item => {
      const key = item.url ?? item.imageUrl;
      return key ? (imageMap.get(key) ?? item) : item;
    }),
  }));
}

async function resolveSearchPlan(
  query: string | string[],
  queryDecomposition: SearchOptions["queryDecomposition"],
  logger: Logger,
): Promise<{
  mode: "single" | "auto" | "batch";
  searches: PlannedSearch[];
  originalQuery?: string;
}> {
  if (Array.isArray(query)) {
    const searches = query
      .map(item => ({ query: item.trim() }))
      .filter(item => item.query);

    return {
      mode: "batch",
      searches,
    };
  }

  if (queryDecomposition) {
    const searches = await planAutomaticSearchQueries({
      query,
      maxQueries: queryDecomposition.maxQueries,
      logger,
    });

    return {
      mode: "auto",
      searches,
      originalQuery: query,
    };
  }

  return {
    mode: "single",
    searches: [{ query }],
    originalQuery: query,
  };
}

export async function executeSearch(
  options: SearchOptions,
  context: SearchContext,
  logger: Logger,
): Promise<SearchExecuteResult> {
  const {
    query,
    limit,
    resultsPerQuery,
    queryDecomposition,
    sources,
    categories,
    scrapeOptions,
  } = options;
  const {
    teamId,
    origin,
    apiKeyId,
    flags,
    requestId,
    bypassBilling,
    zeroDataRetention,
  } = context;

  const searchTypes = [...new Set(sources.map((s: any) => s.type))];
  const searchPlan = await resolveSearchPlan(query, queryDecomposition, logger);
  const perQueryLimit =
    searchPlan.mode === "single" ? limit : Math.min(resultsPerQuery, 100);

  logger.info("Searching for results", {
    searchMode: searchPlan.mode,
    searchCount: searchPlan.searches.length,
    aggregateLimit: limit,
    perQueryLimit,
  });

  const searchExecutions = await Promise.all(
    searchPlan.searches.map(async plannedSearch => {
      const { query: searchQuery, categoryMap } = buildSearchQuery(
        plannedSearch.query,
        categories,
      );
      const numResultsBuffer = Math.max(
        perQueryLimit,
        Math.floor(perQueryLimit * 2),
      );
      const searchResponse = (await search({
        query: searchQuery,
        logger: logger.child({
          searchQuery: plannedSearch.query,
        }),
        advanced: false,
        num_results: numResultsBuffer,
        tbs: options.tbs,
        filter: options.filter,
        lang: options.lang,
        country: options.country,
        location: options.location,
        type: searchTypes,
        enterprise: options.enterprise,
      })) as SearchV2Response;

      const enrichedResponse = applyCategoryLabels(searchResponse, categoryMap);
      const limitedResponse = sliceSearchResponse(
        enrichedResponse,
        perQueryLimit,
      );

      return {
        query: plannedSearch.query,
        goal: plannedSearch.goal,
        response: limitedResponse,
      };
    }),
  );

  const groupedSearches: SearchQueryPlanSearch[] = searchExecutions.map(
    execution => ({
      query: execution.query,
      goal: execution.goal,
      ...execution.response,
    }),
  );

  let totalResultsCount =
    searchPlan.mode === "single"
      ? countSearchResults(searchExecutions[0]?.response ?? {})
      : searchExecutions.reduce(
          (total, execution) => total + countSearchResults(execution.response),
          0,
        );

  const aggregateResponse = aggregateSearchResponses(
    searchExecutions.map(execution => execution.response),
  );
  let response: SearchV2Response =
    searchPlan.mode === "single"
      ? aggregateResponse
      : sliceSearchResponse(aggregateResponse, limit);

  const isZDR = options.enterprise?.includes("zdr");
  const creditsPerTenResults = isZDR ? 10 : 2;
  const searchCredits =
    Math.ceil(totalResultsCount / 10) * creditsPerTenResults;
  let scrapeCredits = 0;

  const shouldScrape =
    scrapeOptions?.formats && scrapeOptions.formats.length > 0;

  if (shouldScrape && scrapeOptions) {
    const itemsToScrape = getItemsToScrape(aggregateResponse, flags);

    if (itemsToScrape.length > 0) {
      const scrapeOpts = {
        teamId,
        origin,
        timeout: options.timeout,
        scrapeOptions,
        bypassBilling: bypassBilling ?? false,
        apiKeyId,
        zeroDataRetention,
        requestId,
      };

      const allDocsWithCostTracking = await scrapeSearchResults(
        itemsToScrape.map(i => i.scrapeInput),
        scrapeOpts,
        logger,
        flags,
      );

      mergeScrapedContent(
        aggregateResponse,
        itemsToScrape,
        allDocsWithCostTracking,
      );
      scrapeCredits = calculateScrapeCredits(allDocsWithCostTracking);
    }
  }

  if (searchPlan.mode !== "single") {
    const queryPlan = buildQueryPlan(
      searchPlan.mode,
      searchPlan.originalQuery,
      perQueryLimit,
      groupedSearches,
    );

    if (shouldScrape) {
      propagateScrapedContentToQueryPlan(queryPlan, aggregateResponse);
    }

    response = {
      ...sliceSearchResponse(aggregateResponse, limit),
      queryPlan,
    };
  } else {
    response = aggregateResponse;
  }

  return {
    response,
    totalResultsCount,
    searchCredits,
    scrapeCredits,
    totalCredits: searchCredits + scrapeCredits,
    shouldScrape: shouldScrape ?? false,
  };
}
