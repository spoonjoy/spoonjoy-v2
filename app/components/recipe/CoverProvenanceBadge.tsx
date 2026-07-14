import clsx from "clsx";

export function normalizeCoverProvenanceLabel(label?: string | null): string | null {
  if (!label) return null;
  return normalizeRequiredCoverProvenanceLabel(label);
}

export function normalizeRequiredCoverProvenanceLabel(label: string): string {
  if (label === "Chef photo") return "Original photo";
  if (label === "Editorialized chef photo") return "Editorial photo";
  return label;
}

export function CoverProvenanceBadge({
  label,
  className,
}: {
  label?: string | null;
  className?: string;
}) {
  const displayLabel = normalizeCoverProvenanceLabel(label);
  if (!displayLabel) return null;

  return (
    <span
      data-testid="cover-provenance-badge"
      className={clsx(
        "font-sj-ui inline-flex min-h-6 max-w-full items-center border border-[rgba(255,252,246,0.76)] bg-[rgba(37,34,31,0.96)] px-2 py-0.5 text-xs/5 font-semibold text-[var(--sj-paper)] shadow-[0_3px_18px_rgba(0,0,0,0.45)] backdrop-blur-sm [text-shadow:0_1px_1px_rgba(0,0,0,0.62)]",
        className,
      )}
    >
      {displayLabel}
    </span>
  );
}
