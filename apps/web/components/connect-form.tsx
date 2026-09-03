"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface League {
  id: string;
  name: string;
  season: string;
  totalRosters: number | null;
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { data?: unknown; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "something went wrong");
  return json.data;
}

export function ConnectForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = (await post("/api/connect", { username: username.trim() })) as {
        leagues: League[];
      };
      setLeagues(data.leagues);
      if (data.leagues.length === 0)
        setError("No NFL leagues found for this username this season.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to connect");
    } finally {
      setBusy(false);
    }
  }

  async function select(leagueId: string) {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/leagues/${leagueId}/select`);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to select league");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={connect} className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Sleeper username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-2 text-text outline-none focus:border-muted"
        />
        <button
          type="submit"
          disabled={busy || username.trim().length === 0}
          className="rounded-sm bg-high px-4 py-2 font-medium text-ink disabled:opacity-40"
        >
          {busy ? "…" : "Connect"}
        </button>
      </form>

      {error ? <p className="text-sm text-alert">{error}</p> : null}

      {leagues && leagues.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
          {leagues.map((league) => (
            <li key={league.id}>
              <button
                onClick={() => select(league.id)}
                disabled={busy}
                className="flex w-full items-center justify-between py-3 text-left disabled:opacity-40"
              >
                <span>{league.name}</span>
                <span className="text-sm text-muted">
                  {league.season} · {league.totalRosters ?? "?"}-team
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
