"use client";

import { useState } from "react";

import type { FullAnalysis } from "@/lib/analysis";

/** amber (low confidence) → teal (high). One continuous ramp — never red/green. */
function confidenceColor(c: number): string {
  const lo = [0xc6, 0x8a, 0x3b];
  const hi = [0x3f, 0xa8, 0x8f];
  const t = Math.max(0, Math.min(1, c));
  const [r, g, b] = lo.map((l, i) => Math.round(l + ((hi[i] ?? l) - l) * t));
  return `rgb(${r} ${g} ${b})`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Dashboard({ analysis }: { analysis: FullAnalysis }) {
  const [opponentAware, setOpponentAware] = useState(true);
  const view = opponentAware ? analysis.winProbability : analysis.expectedPoints;
  const name = (id: string) => analysis.players[id]?.name ?? id;
  const winProb = analysis.winProbability.winProbability;

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

      <ul className="flex flex-col">
        {view.calls.map((call) => {
          const swap = call.current !== null && call.current !== call.recommended;
          const low = call.confidence < 0.6;
          return (
            <li
              key={call.slot + call.recommended}
              className={`flex items-center gap-3 border-b border-hairline py-2.5 ${
                swap ? "border-l-2 border-l-alert pl-2" : ""
              }`}
            >
              <span className="w-10 shrink-0 text-xs text-muted">{call.slot}</span>
              <span className="min-w-0 flex-1 truncate">{name(call.recommended)}</span>
              {swap ? (
                <span className="text-xs text-alert" title={`over ${name(call.current!)}`}>
                  ↑ swap
                </span>
              ) : null}
              {low ? <span title="the choice barely matters">⚠</span> : null}
              <span
                className="w-10 text-right text-sm tabular-nums"
                style={{ color: confidenceColor(call.confidence) }}
              >
                {pct(call.confidence)}
              </span>
            </li>
          );
        })}
      </ul>

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
