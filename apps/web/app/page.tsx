import type { Position } from "@waiver-wire/shared";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="font-display text-2xl font-semibold">Waiver-Wire</h1>
      <p className="text-muted">
        Scaffold in place. Positions from <code>@waiver-wire/shared</code>: {positions.join(" · ")}
      </p>
    </main>
  );
}
