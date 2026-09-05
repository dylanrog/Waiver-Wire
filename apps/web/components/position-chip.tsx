import type { Position } from "@waiver-wire/shared";

const BG: Record<Position, string> = {
  QB: "bg-pos-qb",
  RB: "bg-pos-rb",
  WR: "bg-pos-wr",
  TE: "bg-pos-te",
  K: "bg-pos-k",
  DST: "bg-pos-dst",
};

export function PositionChip({ position }: { position: Position | null }) {
  if (!position) return <span className="inline-block w-8 shrink-0" />;
  return (
    <span
      className={`inline-block w-8 shrink-0 rounded-sm px-1 py-0.5 text-center text-xs font-medium text-ink ${BG[position]}`}
    >
      {position}
    </span>
  );
}
