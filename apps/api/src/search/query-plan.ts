import { generateObject } from "ai";
import type { Logger } from "winston";
import { z } from "zod";
import { getModel } from "../lib/generic-ai";

export interface PlannedSearch {
  query: string;
  goal?: string;
}

const searchPlanSchema = z.object({
  searches: z
    .array(
      z.object({
        query: z.string().min(1).max(500),
        goal: z.string().min(1).max(240).optional(),
      }),
    )
    .min(1)
    .max(10),
});

function normalizePlannedSearches(
  searches: Array<{ query: string; goal?: string }>,
  maxQueries: number,
): PlannedSearch[] {
  const normalized: PlannedSearch[] = [];
  const seen = new Set<string>();

  for (const search of searches) {
    const query = search.query.trim();
    if (!query) continue;

    const dedupeKey = query.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    normalized.push({
      query,
      goal: search.goal?.trim() || undefined,
    });
    seen.add(dedupeKey);

    if (normalized.length >= maxQueries) {
      break;
    }
  }

  return normalized;
}

export function buildFallbackSearchQueries(
  query: string,
  maxQueries: number,
): PlannedSearch[] {
  const variants = [
    {
      query,
      goal: "Capture the core answer directly from a broad query.",
    },
    {
      query: `${query} overview`,
      goal: "Find broad explainers and background context.",
    },
    {
      query: `${query} latest updates`,
      goal: "Find recent changes, releases, or announcements.",
    },
    {
      query: `${query} examples`,
      goal: "Find concrete examples, implementations, or walkthroughs.",
    },
    {
      query: `${query} best practices`,
      goal: "Find guidance, tradeoffs, and recommended patterns.",
    },
    {
      query: `${query} common issues`,
      goal: "Find pitfalls, limitations, and troubleshooting guidance.",
    },
  ];

  return normalizePlannedSearches(variants, maxQueries);
}

export async function planAutomaticSearchQueries({
  query,
  maxQueries,
  logger,
}: {
  query: string;
  maxQueries: number;
  logger: Logger;
}): Promise<PlannedSearch[]> {
  const maxAllowedQueries = Math.max(2, Math.min(maxQueries, 10));
  const minQueries = Math.min(maxAllowedQueries, 3);

  try {
    const result = await generateObject({
      model: getModel("gpt-4o-mini", "openai"),
      schema: searchPlanSchema,
      providerOptions: {
        openai: {
          strictJsonSchema: false,
        },
      },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You generate focused SERP queries for web research.",
            "Return diversified, non-duplicative queries only.",
            "Keep the first query broad and direct.",
            "Preserve important entities, dates, regions, and constraints from the user request.",
            "Today's date is " + new Date().toISOString().split("T")[0] + ".",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Generate between ${minQueries} and ${maxAllowedQueries} search queries for this request: "${query}".`,
            "Each query should help answer a different facet of the request without drifting away from the original intent.",
            "For each query, provide a short goal describing why it exists.",
          ].join("\n"),
        },
      ],
    });

    const plannedSearches = normalizePlannedSearches(
      result.object.searches,
      maxAllowedQueries,
    );

    if (plannedSearches.length > 0) {
      return plannedSearches;
    }
  } catch (error) {
    logger.warn("Automatic search query decomposition failed", {
      error,
      query,
      maxQueries: maxAllowedQueries,
    });
  }

  return buildFallbackSearchQueries(query, maxAllowedQueries);
}
