"use client";

import { useState } from "react";

import type { CallExplanation, Objective, StartSitCall } from "@waiver-wire/shared";

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

type ExplainState = CallExplanation | "loading" | "error";

export function Dashboard({ analysis }: { analysis: FullAnalysis }) {
  const [opponentAware, setOpponentAware] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [prose, setProse] = useState<Record<string, ExplainState>>({});

  const objective: Objective = opponentAware ? "win_probability" : "expected_points";
  const view = opponentAware ? analysis.winProbability : analysis.expectedPoints;
  const name = (id: string | null) => (id ? (analysis.players[id]?.name ?? id) : "");
  const winProb = analysis.winProbability.winProbability;

  async function toggleRow(call: StartSitCall) {
    const key = `${objective}:${call.slot}:${call.recommended}`;
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

      <ul className="flex flex-col">
        {view.calls.map((call) => {
          const key = `${objective}:${call.slot}:${call.recommended}`;
          const swap = call.current !== null && call.current !== call.recommended;
          const low = call.confidence < 0.6;
          const detail = prose[key];
          return (
            <li key={key} className={swap ? "border-l-2 border-l-alert pl-2" : ""}>
              <button
                onClick={() => void toggleRow(call)}
                className="flex w-full items-center gap-3 border-b border-hairline py-2.5 text-left"
              >
                <span className="w-10 shrink-0 text-xs text-muted">{call.slot}</span>
                <span className="min-w-0 flex-1 truncate">{name(call.recommended)}</span>
                {swap ? <span className="text-xs text-alert">↑ swap</span> : null}
                {low ? <span title="the choice barely matters">⚠</span> : null}
                <span
                  className="w-10 text-right text-sm tabular-nums"
                  style={{ color: confidenceColor(call.confidence) }}
                >
                  {pct(call.confidence)}
                </span>
              </button>

              {open === key ? (
                <div className="flex flex-col gap-2 border-b border-hairline bg-surface p-3 text-sm">
                  {detail === "loading" || detail === undefined ? (
                    <p className="text-muted">thinking…</p>
                  ) : detail === "error" ? (
                    <p className="text-alert">couldn&apos;t generate an explanation</p>
                  ) : (
                    <>
                      {swap ? (
                        <p className="text-xs text-muted">over {name(call.current)}</p>
                      ) : null}
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
