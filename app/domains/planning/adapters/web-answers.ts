// The meal plan page's action answers, and which of its forms each one belongs to.
export type PlanActionAnswer =
  | {
      intent?: string;
      errors?: { general?: string };
      error?: string;
      added?: { meals: number; missing: number };
      /** The list the week went on, when it isn't the cook's own shopping list. */
      list?: { name: string; href: string };
      /** A calendar link just made: shown this once, since only its hash is kept. */
      feedUrl?: string;
      /** Whether making that link replaced one the cook had. */
      replaced?: boolean;
      /** Whether turning the link off found one to turn off. */
      revoked?: boolean;
    }
  | undefined;

/** The errors to show on the form that sent `intent`: its refusal, or the busy database's message. */
export function errorsFor(answer: PlanActionAnswer, intent: string) {
  if (answer?.intent !== intent) return undefined;
  return answer.errors ?? { general: answer.error };
}
