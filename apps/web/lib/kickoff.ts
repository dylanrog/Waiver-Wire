import type { GameLine } from "./matchup-view";

/**
 * "DET vs GB · Sun 1:00" / "NE @ SEA · Sun 8:20" / "DET vs GB · Final" / "BYE".
 * `timeZone` is injectable for tests; in the browser it defaults to the
 * viewer's local timezone.
 */
export function formatGameLine(
  game: GameLine,
  playerTeam: string | null,
  timeZone: string | undefined = undefined,
): string {
  if (!playerTeam) return "";
  if (!game) return "BYE";

  const vs = game.home ? "vs" : "@";
  const matchup = `${playerTeam} ${vs} ${game.opponent}`;

  if (game.status === "final") return `${matchup} · Final`;

  const kickoff = new Date(game.kickoff);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(kickoff);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(kickoff)
    .replace(/\s?[AP]M$/, "");

  return `${matchup} · ${day} ${time}`;
}
