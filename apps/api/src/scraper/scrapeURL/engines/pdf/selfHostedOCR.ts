import { Meta } from "../..";
import { config } from "../../../../config";
import { robustFetch } from "../../lib/fetch";
import { z } from "zod";

/**
 * Compute word-level Jaccard similarity between two texts.
 * Strips markdown syntax and normalises whitespace so we compare
 * the underlying data, not formatting differences.
 */
function wordSimilarity(a: string, b: string): number {
  const normalise = (s: string) =>
    s
      .replace(/[#*_`\[\]()>|~\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const wordsA = new Set(normalise(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalise(b).split(" ").filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  return intersection / (wordsA.size + wordsB.size - intersection);
}

export interface MUv1Deferred {
  promise: Promise<{ markdown: string; durationMs: number }>;
  resolve: (v: { markdown: string; durationMs: number }) => void;
  reject: (e: unknown) => void;
}

export function createMUv1Deferred(): MUv1Deferred {
  let resolve!: MUv1Deferred["resolve"];
  let reject!: MUv1Deferred["reject"];
  const promise = new Promise<{ markdown: string; durationMs: number }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

export function runSelfHostedOCRExperiment(
  meta: Meta,
  base64Content: string,
  muV1Deferred: MUv1Deferred,
  maxPages?: number,
): void {
  if (
    !config.PDF_OCR_EXPERIMENT_ENABLE ||
    !config.PDF_OCR_BASE_URL ||
    Math.random() * 100 >= config.PDF_OCR_EXPERIMENT_PERCENT
  ) {
    return;
  }

  (async () => {
    const startedAt = Date.now();
    const logger = meta.logger.child({ method: "scrapePDF/selfHostedOCR" });
    logger.info("Self-hosted OCR experiment started", {
      scrapeId: meta.id,
      url: meta.rewrittenUrl ?? meta.url,
      maxPages,
    });
    try {
      const resp = await robustFetch({
        url: `${config.PDF_OCR_BASE_URL}/ocr`,
        method: "POST",
        headers: config.PDF_OCR_API_KEY
          ? { Authorization: `Bearer ${config.PDF_OCR_API_KEY}` }
          : undefined,
        body: {
          pdf: base64Content,
          ...(maxPages !== undefined && { max_pages: maxPages }),
        },
        logger,
        schema: z.object({
          markdown: z.string(),
          failed_pages: z.array(z.number()).nullable(),
        }),
        mock: meta.mock,
        abort: meta.abort.asSignal(),
      });
      const ocrDurationMs = Date.now() - startedAt;

      // Wait for MU v1 to finish so we can compare
      const muV1 = await muV1Deferred.promise;
      const similarity = wordSimilarity(resp.markdown, muV1.markdown);

      logger.info("Self-hosted OCR experiment completed", {
        scrapeId: meta.id,
        url: meta.rewrittenUrl ?? meta.url,
        ocrDurationMs,
        muV1DurationMs: muV1.durationMs,
        ocrMarkdownLength: resp.markdown.length,
        muV1MarkdownLength: muV1.markdown.length,
        wordSimilarity: Math.round(similarity * 1000) / 1000,
        failedPages: resp.failed_pages,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.warn("Self-hosted OCR experiment failed", { error, durationMs });
    }
  })();
}
