/**
 * The recipe's cook time for its meta row, as the Apple app writes it (RecipeCookTime): the timed
 * steps added up, "23 min", "1 hr" or "1 hr 5 min". Undefined when no step is timed, so the meta
 * row leaves the clause out.
 */
export function cookTimeLabel(stepMinutes: ReadonlyArray<number | null | undefined>): string | undefined {
  const minutes = stepMinutes.reduce<number>((total, value) => total + (value && value > 0 ? value : 0), 0);
  if (minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
