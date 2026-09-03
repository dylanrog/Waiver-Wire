import {
  type NameQuery,
  type NameResolution,
  PlayerId,
  type Position,
  type ResolvedName,
  type SourceId,
  type UnresolvedName,
  type Week,
} from "@waiver-wire/shared";

/** The slice of a Sleeper player the resolver needs. */
export interface ResolverPlayer {
  id: string;
  fullName: string | null;
  lastName: string | null;
  /** Sleeper's primary position string (e.g. "DEF", "QB"). */
  position: string | null;
  fantasyPositions: string[] | null;
  /** NFL team abbreviation, or null for a free agent. */
  team: string | null;
}

const SUFFIX = /\s+(?:jr|sr|ii|iii|iv|v)\.?$/i;
const NON_ALNUM = /[^a-z0-9]/g;
const DIACRITICS = /\p{Diacritic}/gu;

function normalize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(SUFFIX, "")
    .replace(NON_ALNUM, "");
}

function lastToken(name: string): string {
  const parts = name.toLowerCase().replace(SUFFIX, "").trim().split(/\s+/);
  return normalize(parts[parts.length - 1] ?? "");
}

/** FantasyPros (and others) vs Sleeper NFL abbreviations. */
const TEAM_ALIASES: Record<string, string> = { JAC: "JAX", WSH: "WAS", LA: "LAR" };

function normalizeTeam(abbr: string | null): string | null {
  if (abbr === null || abbr === "") return null;
  const upper = abbr.toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

function sleeperPositionsFor(position: Position): string[] {
  return position === "DST" ? ["DEF", "DST"] : [position];
}

function playsPosition(player: ResolverPlayer, position: Position): boolean {
  const wanted = sleeperPositionsFor(position);
  const have = [player.position, ...(player.fantasyPositions ?? [])];
  return have.some((p) => p !== null && wanted.includes(p.toUpperCase()));
}

function narrowByTeam(matches: ResolverPlayer[], team: string | null): ResolverPlayer[] {
  if (matches.length <= 1 || team === null) return matches;
  const normalized = normalizeTeam(team);
  const narrowed = matches.filter((p) => normalizeTeam(p.team) === normalized);
  return narrowed.length > 0 ? narrowed : matches;
}

/**
 * Resolve source ranking names to Sleeper player ids. Pure — pass the player
 * index in. Every miss (no match, or an ambiguity we won't guess through) comes
 * back as an {@link UnresolvedName}, never silently dropped (see MVP.md §2).
 */
export function resolveRankingNames(
  players: readonly ResolverPlayer[],
  queries: readonly NameQuery[],
  ctx: { source: SourceId; week: Week },
): NameResolution {
  const resolved: ResolvedName[] = [];
  const unresolved: UnresolvedName[] = [];

  for (const query of queries) {
    const id = resolveOne(players, query);
    if (id === null) {
      unresolved.push({
        source: ctx.source,
        week: ctx.week,
        rawName: query.rawName,
        position: query.position,
      });
    } else {
      resolved.push({
        rawName: query.rawName,
        position: query.position,
        playerId: PlayerId.parse(id),
      });
    }
  }

  return { resolved, unresolved };
}

function resolveOne(players: readonly ResolverPlayer[], query: NameQuery): string | null {
  const eligible = players.filter((p) => playsPosition(p, query.position));

  if (query.position === "DST") {
    const team = normalizeTeam(query.team);
    const byTeam = eligible.filter(
      (p) => normalizeTeam(p.team) === team || p.id.toUpperCase() === team,
    );
    if (byTeam.length === 1) return byTeam[0]?.id ?? null;
  }

  // Tier 1 — exact full name, case- and whitespace-folded.
  const wanted = query.rawName.trim().toLowerCase();
  const exact = eligible.filter((p) => p.fullName?.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]?.id ?? null;

  // Tier 2 — normalized full name (punctuation, casing, suffixes).
  const target = normalize(query.rawName);
  const normed = narrowByTeam(
    eligible.filter((p) => p.fullName !== null && normalize(p.fullName) === target),
    query.team,
  );
  if (normed.length === 1) return normed[0]?.id ?? null;

  // Tier 3 — last name + team + position.
  const last = lastToken(query.rawName);
  const team = normalizeTeam(query.team);
  const byLast = eligible.filter(
    (p) =>
      p.lastName !== null &&
      normalize(p.lastName) === last &&
      team !== null &&
      normalizeTeam(p.team) === team,
  );
  if (byLast.length === 1) return byLast[0]?.id ?? null;

  return null;
}
