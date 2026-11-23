// The meal plan page's action answers, and which of its forms each one belongs to.
export type PlanActionAnswer =
  | { intent?: string; errors?: { general?: string }; error?: string; added?: { recipes: number; missing: number } }
  | undefined;

/** The errors to show on the form that sent `intent`: its refusal, or the busy database's message. */
export function errorsFor(answer: PlanActionAnswer, intent: string) {
  if (answer?.intent !== intent) return undefined;
  return answer.errors ?? { general: answer.error };
}
