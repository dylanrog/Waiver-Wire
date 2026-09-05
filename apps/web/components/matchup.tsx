"use client";

import type { CallExplanation, StartSitCall } from "@waiver-wire/shared";

import type { FullAnalysis } from "@/lib/analysis";
import { confidenceColor, pct } from "@/lib/confidence";
import { formatGameLine } from "@/lib/kickoff";
import type { MatchupPlayer, MyMatchupPlayer } from "@/lib/matchup-view";

import { PositionChip } from "./position-chip";

const num = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(1));
const shortName = (first: string | null, last: string | null, full: string) =>
  first && last ? `${first[0]}.${last}` : full;

function Injury({ status }: { status: string | null }) {
  if (!status) return null;
  const tag = status.slice(0, 1).toUpperCase();
  return <span className="ml-1 align-top text-[10px] text-alert">{tag}</span>;
}

export type ExplainState = CallExplanation | "loading" | "error";

const isBench = <T extends { slot: string }>(p: T) => p.slot === "BENCH";

interface Props {
  analysis: FullAnalysis;
  /**
   * The active objective's start/sit calls, keyed by `call.recommended`. Flips
   * with the opponent-aware toggle, so a row's recommendation, confidence and
   * swap badge all track the toggle (analyze.ts guarantees `recommended` is
   * unique across a calls array).
   */
  callByPlayerId: Map<string, StartSitCall>;
  onToggleRow: (player: MyMatchupPlayer) => void;
  openKey: string | null;
  prose: Record<string, ExplainState>;
  rowKey: (player: MyMatchupPlayer) => string;
}

/** My full lineup wide on the left; the opponent's roster as a narrow rail. */
export function Matchup({ analysis, callByPlayerId, onToggleRow, openKey, prose, rowKey }: Props) {
  const myStarters = analysis.myTeam.filter((p) => !isBench(p));
  const myBench = analysis.myTeam.filter(isBench);
  const oppStarters = analysis.opponentTeam.filter((p) => !isBench(p));
  const oppBench = analysis.opponentTeam.filter(isBench);

  const playerName = (id: string) => analysis.players[id]?.name ?? id;

  const row = (mine: MyMatchupPlayer | null, opp: MatchupPlayer | null, fallbackKey: string) => {
    const call = mine ? (callByPlayerId.get(mine.playerId) ?? null) : null;
    const key = mine ? rowKey(mine) : fallbackKey;
    // A row is tappable whenever it carries a call — starter OR the bench player
    // the sim wants started over a current starter.
    return (
      <MatchupRow
        key={key}
        mine={mine}
        opp={opp}
        call={call}
        expanded={mine != null && openKey === key}
        detail={mine ? prose[key] : undefined}
        onClick={mine && call ? () => onToggleRow(mine) : undefined}
        name={playerName}
      />
    );
  };

  const benchRows = Math.max(myBench.length, oppBench.length);

  return (
    <section className="flex flex-col">
      <div className="flex justify-between pb-1 text-xs text-muted">
        <span>My team</span>
        <span className="w-28 shrink-0 truncate pl-1.5 text-right">
          {analysis.opponentTeamName}
        </span>
      </div>

      {myStarters.map((mine, i) => row(mine, oppStarters[i] ?? null, `s${i}`))}

      <div className="mt-2 border-t border-hairline pt-1.5 text-xs text-muted">bench</div>
      {Array.from({ length: benchRows }, (_, i) =>
        row(myBench[i] ?? null, oppBench[i] ?? null, `b${i}`),
      )}
    </section>
  );
}

function MatchupRow({
  mine,
  opp,
  call,
  expanded,
  detail,
  onClick,
  name,
}: {
  mine: MyMatchupPlayer | null;
  opp: MatchupPlayer | null;
  call: StartSitCall | null;
  expanded: boolean;
  detail: ExplainState | undefined;
  onClick: (() => void) | undefined;
  name: (id: string) => string;
}) {
  const displaced =
    call?.current && call.current !== call.recommended ? call.current : null;

  return (
    <div className={displaced ? "border-l-2 border-l-alert pl-1.5" : "pl-1.5"}>
      <div className="flex items-start gap-2 border-b border-hairline py-1.5">
        {mine ? (
          <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
          >
            <span className="flex w-full items-center gap-1.5">
              <PositionChip position={mine.position} />
              <span className="min-w-0 flex-1 truncate">
                {shortName(mine.firstName, mine.lastName, mine.fullName)}
                <Injury status={mine.injuryStatus} />
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                <span className="text-text">{num(mine.ourProjection?.mean)}</span>
                <span className="text-muted"> · {num(mine.platformPoints)}</span>
              </span>
              {call ? (
                <span
                  className="w-9 shrink-0 text-right text-sm tabular-nums"
                  style={{ color: confidenceColor(call.confidence) }}
                >
                  {pct(call.confidence)}
                </span>
              ) : (
                <span className="w-9 shrink-0" />
              )}
            </span>
            <span className="pl-9 text-xs text-muted" suppressHydrationWarning>
              {formatGameLine(mine.game, mine.team)}
              {displaced ? (
                <span className="text-alert"> · ↑ over {name(displaced)}</span>
              ) : null}
            </span>
          </button>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}

        <div className="w-28 shrink-0 overflow-hidden border-l border-hairline pl-1.5">
          {opp ? (
            <>
              <span className="flex items-center gap-1.5">
                <PositionChip position={opp.position} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {shortName(opp.firstName, opp.lastName, opp.fullName)}
                  <Injury status={opp.injuryStatus} />
                </span>
              </span>
              <span
                className="block truncate pl-9 text-xs text-muted tabular-nums"
                suppressHydrationWarning
              >
                {[num(opp.platformPoints), formatGameLine(opp.game, opp.team)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {expanded && detail ? (
        <div className="flex flex-col gap-2 border-b border-hairline bg-surface p-3 text-sm">
          {detail === "loading" ? (
            <p className="text-muted">thinking…</p>
          ) : detail === "error" ? (
            <p className="text-alert">couldn&apos;t generate an explanation</p>
          ) : (
            <>
              <ul className="flex flex-col gap-0.5">
                {detail.pros.map((p) => (
                  <li key={p} className="text-high">
                    + {p}
                  </li>
                ))}
                {detail.cons.map((c) => (
                  <li key={c} className="text-low">
                    − {c}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{detail.toggleEffect}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
