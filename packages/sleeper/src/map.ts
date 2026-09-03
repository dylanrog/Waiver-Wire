import { Player } from "@waiver-wire/shared";

import type { ResolverPlayer } from "./resolver";
import type { SleeperPlayer } from "./schemas";

function displayName(p: SleeperPlayer): string | null {
  if (p.full_name) return p.full_name;
  if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
  return null;
}

/** Project Sleeper players onto the slice the name resolver needs. */
export function toResolverPlayers(players: readonly SleeperPlayer[]): ResolverPlayer[] {
  return players.map((p) => ({
    id: p.player_id,
    fullName: displayName(p),
    lastName: p.last_name ?? null,
    position: p.position ?? null,
    fantasyPositions: p.fantasy_positions ?? null,
    team: p.team ?? null,
  }));
}

const DOMAIN_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

const INJURY: Record<string, "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "IR" | "ACTIVE"> = {
  out: "OUT",
  doubtful: "DOUBTFUL",
  questionable: "QUESTIONABLE",
  ir: "IR",
  active: "ACTIVE",
};

/**
 * Map to the shared domain `Player`. Returns null for anything outside the six
 * fantasy positions or missing a name — the player cache keeps those, the domain
 * layer doesn't need them. `byeWeek` is always null here (Sleeper's player
 * payload doesn't carry it; it comes from the schedule).
 */
export function toPlayer(p: SleeperPlayer): Player | null {
  const position = p.position === "DEF" ? "DST" : p.position;
  const name = displayName(p);
  if (!position || !DOMAIN_POSITIONS.has(position) || !name) return null;

  const parsed = Player.safeParse({
    id: p.player_id,
    fullName: name,
    position,
    team: p.team ?? null,
    byeWeek: null,
    injuryStatus: p.injury_status ? (INJURY[p.injury_status.toLowerCase()] ?? null) : null,
  });
  return parsed.success ? parsed.data : null;
}
