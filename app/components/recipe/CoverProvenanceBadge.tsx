import { Badge } from "~/components/ouro/badge/badge";

export function normalizeCoverProvenanceLabel(label?: string | null): string | null {
  if (!label) return null;
  return normalizeRequiredCoverProvenanceLabel(label);
}

export function normalizeRequiredCoverProvenanceLabel(label: string): string {
  const normalized = label.trim();
  const legacyLabel = normalized.toLowerCase();
  if (legacyLabel === "chef photo") return "Original photo";
  if (legacyLabel === "editorialized chef photo") return "Editorial photo";
  if (legacyLabel === "spoonjoy cookbook" || legacyLabel === "on the counter") return "Saved cover";
  return normalized;
}

/** Where a recipe's cover came from, as an HX Badge; nothing when the cover has no label. */
export function CoverProvenanceBadge({
  label,
  className,
}: {
  label?: string | null;
  /** Layout only: where the badge sits over a photo. */
  className?: string;
}) {
  const displayLabel = normalizeCoverProvenanceLabel(label);
  if (!displayLabel) return null;

  return (
    <Badge data-testid="cover-provenance-badge" className={className}>
      {displayLabel}
    </Badge>
  );
}
