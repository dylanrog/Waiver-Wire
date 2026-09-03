import type { NameResolver, RankingSource, SourceId } from "@waiver-wire/shared";

import type { RawFetchCache } from "./cache";
import { createFantasyProsSource, type Scoring } from "./fantasypros";

export interface SourceDeps {
  resolve: NameResolver;
  cache: RawFetchCache;
  userAgent: string;
  scoring: Scoring;
  offline?: boolean;
  fetchImpl?: typeof fetch;
}

type SourceFactory = (deps: SourceDeps) => RankingSource;

/** Add a source here and callers pick it up by id — no other change. */
const REGISTRY: Record<SourceId, SourceFactory> = {
  fantasypros: (deps) => createFantasyProsSource(deps),
};

export const rankingSourceIds = Object.keys(REGISTRY) as SourceId[];

export function createRankingSource(id: SourceId, deps: SourceDeps): RankingSource {
  return REGISTRY[id](deps);
}
