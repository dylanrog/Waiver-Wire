import type { z, ZodTypeAny } from "zod";

import {
  SleeperNotFound,
  SleeperRateLimited,
  SleeperResponseInvalid,
  SleeperUnavailable,
} from "./errors";

export interface SleeperClientOptions {
  baseUrl?: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
}

export interface ResolvedOptions {
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  userAgent: string;
}

const DEFAULTS = {
  baseUrl: "https://api.sleeper.app/v1",
  timeoutMs: 10_000,
  maxRetries: 3,
  retryDelayMs: 400,
  userAgent: "waiver-wire (personal fantasy tool)",
} as const;

export function resolveOptions(options: SleeperClientOptions = {}): ResolvedOptions {
  return {
    baseUrl: (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
    retryDelayMs: options.retryDelayMs ?? DEFAULTS.retryDelayMs,
    userAgent: options.userAgent ?? DEFAULTS.userAgent,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a Sleeper endpoint and validate it. Retries 5xx / 429 / network / timeout
 * with linear backoff; maps failures to typed errors. 404 and schema mismatches
 * are terminal — no retry.
 */
export async function getJson<S extends ZodTypeAny>(
  path: string,
  schema: S,
  opts: ResolvedOptions,
): Promise<z.infer<S>> {
  const url = `${opts.baseUrl}${path}`;
  let lastError: Error = new SleeperUnavailable(url);

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) await sleep(opts.retryDelayMs * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await opts.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": opts.userAgent },
      });

      if (res.status === 404) throw new SleeperNotFound(url);
      if (res.status === 429) {
        lastError = new SleeperRateLimited(url);
        continue;
      }
      if (res.status >= 500) {
        lastError = new SleeperUnavailable(`${url} → ${res.status}`);
        continue;
      }
      if (!res.ok) throw new SleeperUnavailable(`${url} → ${res.status}`);

      const body: unknown = await res.json();
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new SleeperResponseInvalid(
          `${url}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof SleeperNotFound || err instanceof SleeperResponseInvalid) throw err;
      lastError =
        err instanceof Error ? new SleeperUnavailable(`${url}: ${err.message}`) : lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
