"use client";

import { useState } from "react";

import type { CallExplanation, Objective, StartSitCall } from "@waiver-wire/shared";

import type { FullAnalysis } from "@/lib/analysis";
import { pct } from "@/lib/confidence";
import type { MyMatchupPlayer } from "@/lib/matchup-view";

import { Matchup, type ExplainState } from "./matchup";

export function Dashboard({ analysis }: { analysis: FullAnalysis }) {
  const [opponentAware, setOpponentAware] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [prose, setProse] = useState<Record<string, ExplainState>>({});

  const objective: Objective = opponentAware ? "win_probability" : "expected_points";
  const view = opponentAware ? analysis.winProbability : analysis.expectedPoints;
  const name = (id: string | null) => (id ? (analysis.players[id]?.name ?? id) : "");
  const winProb = analysis.winProbability.winProbability;

  // Start/sit calls for the active objective, so the whole roster view — which
  // player is recommended, the confidence %, the swap badges — tracks the
  // opponent-aware toggle. `recommended` is unique across a calls array.
  const callByPlayerId = new Map<string, StartSitCall>(
    view.calls.map((c) => [c.recommended as string, c]),
  );

  const rowKey = (player: MyMatchupPlayer) =>
    `${objective}:${player.slot}:${player.playerId}`;

  async function toggleRow(player: MyMatchupPlayer) {
    const call = callByPlayerId.get(player.playerId) ?? null;
    if (call === null) return;

    const key = rowKey(player);
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    if (prose[key]) return;
    setProse((p) => ({ ...p, [key]: "loading" }));
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          call,
          objective,
          recommendedName: name(call.recommended),
          alternativeName: call.alternative ? name(call.alternative) : null,
          currentName: call.current ? name(call.current) : null,
          opponentName: analysis.opponentName,
          winProbability: winProb,
        }),
      });
      const json = (await res.json()) as { data?: CallExplanation };
      setProse((p) => ({ ...p, [key]: json.data ?? "error" }));
    } catch {
      setProse((p) => ({ ...p, [key]: "error" }));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          Week {analysis.week} · vs {analysis.opponentName} · {analysis.scoring}
        </p>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold tabular-nums">{pct(winProb)}</span>
            <span className="text-sm text-muted">win probability</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-hairline">
            <div className="h-full rounded-full bg-high" style={{ width: pct(winProb) }} />
          </div>
          <p className="mt-1 text-xs text-muted tabular-nums">
            you score {Math.round(view.myScore.p10)}–{Math.round(view.myScore.p90)} · them{" "}
            {Math.round(view.opponentScore.p50)}
          </p>
        </div>
      </header>

      <label className="flex items-center justify-between border-y border-hairline py-3">
        <span className="text-sm">Opponent-aware</span>
        <input
          type="checkbox"
          checked={opponentAware}
          onChange={(e) => setOpponentAware(e.target.checked)}
          className="h-5 w-9 appearance-none rounded-full bg-hairline transition-colors checked:bg-high"
        />
      </label>

      <Matchup
        analysis={analysis}
        callByPlayerId={callByPlayerId}
        onToggleRow={(player) => void toggleRow(player)}
        openKey={open}
        prose={prose}
        rowKey={rowKey}
      />

      {analysis.waivers.some((w) => w.candidates.length > 0) ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-muted">Streaming</h2>
          {analysis.waivers
            .filter((w) => w.candidates.length > 0)
            .map((scan) => (
              <div key={scan.slot} className="flex flex-col gap-1 border-t border-hairline pt-2">
                <p className="text-xs text-muted">{scan.slot}</p>
                {scan.candidates.slice(0, 3).map((c) => (
                  <div key={c.playerId} className="flex justify-between text-sm">
                    <span className="truncate">{name(c.playerId)}</span>
                    <span
                      className="tabular-nums"
                      style={{
                        color:
                          c.upgradeOverCurrent > 0 ? "var(--color-high)" : "var(--color-muted)",
                      }}
                    >
                      {c.upgradeOverCurrent > 0 ? "+" : ""}
                      {c.upgradeOverCurrent.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
        </section>
      ) : null}
    </main>
  );
}
