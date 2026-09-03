import { createDb } from "./client";
import { loadEnv } from "./load-env";
import { upsertLeague, upsertPlayers, upsertRosters } from "./queries";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const db = createDb(url);

// A tiny deterministic league so the app renders something before a real Sleeper
// sync. Idempotent — safe to re-run.
await upsertLeague(db, {
  id: "DEMO",
  name: "Demo League",
  season: "2026",
  totalRosters: 2,
  scoringSettings: { rec: 0.5 },
  rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN"],
});

await upsertPlayers(db, [
  {
    id: "4046",
    fullName: "Patrick Mahomes",
    firstName: "Patrick",
    lastName: "Mahomes",
    position: "QB",
    team: "KC",
  },
  {
    id: "6786",
    fullName: "Jahmyr Gibbs",
    firstName: "Jahmyr",
    lastName: "Gibbs",
    position: "RB",
    team: "DET",
  },
  { id: "KC", fullName: "Kansas City Chiefs", position: "DST", team: "KC" },
]);

await upsertRosters(db, "DEMO", [
  {
    sleeperRosterId: 1,
    ownerDisplayName: "you",
    isCurrentUser: true,
    players: ["4046", "6786", "KC"],
    starters: ["4046", "6786"],
  },
  { sleeperRosterId: 2, ownerDisplayName: "rival", players: [], starters: [] },
]);

console.log("seeded demo league");
process.exit(0);
