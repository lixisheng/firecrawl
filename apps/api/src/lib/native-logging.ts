import type { Logger } from "winston";

/** Matches the NativeLogEntry struct from Rust (@mendable/firecrawl-rs). */
export interface NativeLogEntry {
  level: string;
  target: string;
  message: string;
  fields: Record<string, unknown>;
  timestampMs: number;
}

/**
 * Emit log entries captured inside the Rust native module through a Winston
 * logger, preserving trace context (scrape_id / url via the parent logger)
 * and adding `source: "native"` + the Rust module name as labels.
 */
export function emitNativeLogs(
  logs: NativeLogEntry[] | undefined,
  parentLogger: Logger,
  module: string,
): void {
  if (!logs || logs.length === 0) return;

  const childLogger = parentLogger.child({ source: "native", module });

  for (const entry of logs) {
    const meta = {
      rustTarget: entry.target,
      ...entry.fields,
    };

    switch (entry.level) {
      case "error":
        childLogger.error(entry.message, meta);
        break;
      case "warn":
        childLogger.warn(entry.message, meta);
        break;
      case "info":
        childLogger.info(entry.message, meta);
        break;
      case "debug":
      case "trace":
        childLogger.debug(entry.message, meta);
        break;
      default:
        childLogger.info(entry.message, meta);
    }
  }
}
