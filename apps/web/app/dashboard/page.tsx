import Link from "next/link";
import { redirect } from "next/navigation";

import { analyzeLeague } from "@/lib/analysis";
import { Dashboard } from "@/components/dashboard";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session?.leagueId) redirect("/connect");

  const analysis = await analyzeLeague(session.leagueId);

  if (!analysis) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
        <p className="text-muted">This league isn&apos;t synced.</p>
        <Link href="/connect" className="text-high underline">
          Pick a league
        </Link>
      </main>
    );
  }

  if (analysis.expectedPoints.calls.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="font-display text-xl font-semibold">Week {analysis.week}</h1>
        <p className="text-muted">
          No lineup to analyze yet — your roster is empty. Draft, then{" "}
          <Link href="/connect" className="text-high underline">
            re-select the league
          </Link>{" "}
          to sync it.
        </p>
      </main>
    );
  }

  return <Dashboard analysis={analysis} />;
}
