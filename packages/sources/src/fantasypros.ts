import {
  type NameQuery,
  type NameResolver,
  type Position,
  type RankingsResult,
  type RankingSource,
  SourceRanking,
  type UnresolvedName,
  type Week,
} from "@waiver-wire/shared";

import type { RawFetchCache } from "./cache";
import { type EcrPlayer, parseEcrData } from "./ecr";

export type Scoring = "STD" | "HALF" | "PPR";

export interface FantasyProsOptions {
  /** From the league's scoring settings. QB / K / DST pages ignore this. */
  scoring: Scoring;
  /** Bound name resolver, injected by the caller (`sources` never imports `sleeper`). */
  resolve: NameResolver;
  cache: RawFetchCache;
  /** Sent on every request. Identifiable, not a browser string (CLAUDE.md). */
  userAgent: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Serve only from cache; never hit the network. */
  offline?: boolean;
}

const SOURCE = "fantasypros" as const;
const DEFAULT_BASE = "https://www.fantasypros.com/nfl/rankings";

const SLUG: Record<Position, string> = {
  QB: "qb",
  RB: "rb",
  WR: "wr",
  TE: "te",
  K: "k",
  DST: "dst",
};
const SCORING_INVARIANT = new Set<Position>(["QB", "K", "DST"]);

export function pageUrl(base: string, position: Position, scoring: Scoring, week: number): string {
  const prefix =
    SCORING_INVARIANT.has(position) || scoring === "STD"
      ? ""
      : scoring === "PPR"
        ? "ppr-"
        : "half-point-ppr-";
  return `${base}/${prefix}${SLUG[position]}.php?week=${week}`;
}

export function createFantasyProsSource(options: FantasyProsOptions): RankingSource {
  const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  async function fetchPage(url: string, week: number): Promise<string> {
    const cached = await options.cache.read({ url, source: SOURCE, week });
    if (cached !== null) return cached;
    if (options.offline) {
      throw new Error(`offline and no cached FantasyPros fetch for ${url}`);
    }

    const res = await fetchImpl(url, {
      headers: { "user-agent": options.userAgent, accept: "text/html" },
    });
    if (!res.ok) throw new Error(`FantasyPros ${url} → ${res.status}`);
    const body = await res.text();

    await options.cache.write({
      url,
      source: SOURCE,
      week,
      body,
      contentType: res.headers.get("content-type") ?? "text/html",
      fetchedAt: new Date(),
    });
    return body;
  }

  async function rankingsForPosition(
    position: Position,
    week: number,
    fetchedAt: Date,
  ): Promise<RankingsResult> {
    const url = pageUrl(base, position, options.scoring, week);
    const ecr = parseEcrData(await fetchPage(url, week));

    if (ecr.position_id.toUpperCase() !== position) {
      throw new Error(
        `FantasyPros ${url} returned position "${ecr.position_id}", expected "${position}"`,
      );
    }

    const rowByName = new Map<string, EcrPlayer>();
    const queries: NameQuery[] = [];
    for (const player of ecr.players) {
      rowByName.set(player.player_name, player);
      queries.push({ rawName: player.player_name, team: player.player_team_id ?? null, position });
    }

    const { resolved, unresolved } = options.resolve(queries, { source: SOURCE, week });

    const rankings = resolved.flatMap((match) => {
      const row = rowByName.get(match.rawName);
      if (row === undefined || match.position !== position) return [];
      return [
        SourceRanking.parse({
          source: SOURCE,
          week,
          position,
          rank: row.rank_ecr,
          playerId: match.playerId,
          sourceExcerpt: JSON.stringify(row),
          fetchedAt,
        }),
      ];
    });

    return { rankings, unresolved };
  }

  return {
    id: SOURCE,
    displayName: "FantasyPros",

    async getRankings(week: Week, positions: Position[]): Promise<RankingsResult> {
      const fetchedAt = new Date();
      const rankings: SourceRanking[] = [];
      const unresolved: UnresolvedName[] = [];

      for (const position of positions) {
        const result = await rankingsForPosition(position, week, fetchedAt);
        rankings.push(...result.rankings);
        unresolved.push(...result.unresolved);
      }

      rankings.sort((a, b) =>
        a.position === b.position ? a.rank - b.rank : a.position.localeCompare(b.position),
      );
      return { rankings, unresolved };
    },
  };
}
