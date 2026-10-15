import { useMemo, useState } from "react";
import { formErrors, type FormErrors, type FormErrorValue } from "~/lib/ouro/form-answer";

/** What a Spoonjoy action returns in `errors`: a message per field name, and `general` for the whole form. */
export type ActionErrors = Readonly<FormErrors>;

/**
 * An action's `errors` in the shape Ouro UI's `Form` takes in its `errors` prop. Each message
 * lands on the field with that `name`. Spoonjoy's `general` message is Ouro's `form` key, which
 * shows at the top of the form. Empty entries are left out.
 *
 * Pass `fields`, a constant list of the form's field names, when the action also answers with
 * errors the form has no field for and the page shows elsewhere: only those names and `general`
 * reach the form. `Form` warns about a name none of its fields has.
 *
 * `answer` is the actual accepted response owned by this form, not its errors projection.
 * Rebuilding messages for that response never invents an arrival. Without an answer, the
 * messages are a display baseline: they neither restore cleared fields nor move focus.
 */
export function useFormErrors(
  errors: ActionErrors | null | undefined,
  fields?: readonly string[],
  answer?: object | null,
): FormErrorValue {
  return useMemo(() => {
    const messages: FormErrors = {};
    for (const [name, message] of Object.entries(errors ?? {})) {
      if (message === null || message === undefined ||
          ((typeof message === "string" || Array.isArray(message)) && message.length === 0)) continue;
      if (name === "general") messages.form = message;
      else if (!fields || fields.includes(name)) messages[name] = message;
    }
    return formErrors(answer, messages);
  }, [errors, fields, answer]);
}

/**
 * One message about the whole form (an action that answers `{ error }`, with no field to put it
 * on) in the shape Ouro UI's `Form` takes: it shows at the top of the form.
 *
 * `answer` is the action result the message came from. The result is a new object for each
 * answer, not for each message text: the same refusal twice must show and take focus twice.
 */
export function useFormMessage(message: string | null | undefined, answer?: object | null): FormErrorValue {
  return useMemo(() => formErrors(answer, message ? { form: message } : undefined), [message, answer]);
}

/**
 * Select an existing intent-tagged response for this form. Unrelated route answers
 * do not replace its last accepted response. The caller supplies the owning intents;
 * this does not infer request ownership from navigation, field names or submit start.
 */
export function useIntentAnswer<T extends { intent?: unknown }>(
  source: T | null | undefined,
  intents: readonly string[],
): T | undefined {
  const own = source != null && typeof source.intent === "string" && intents.includes(source.intent);
  const [previous, setPrevious] = useState({ seen: source, accepted: own ? source : undefined });
  if (source !== previous.seen) {
    setPrevious({ seen: source, accepted: own ? source : previous.accepted });
  }
  return own ? source : previous.accepted;
}
