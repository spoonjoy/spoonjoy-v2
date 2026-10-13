import { useMemo } from "react";
import type { FormErrors } from "~/components/ouro/form/form";

/** What a Spoonjoy action returns in `errors`: a message per field name, and `general` for the whole form. */
export type ActionErrors = Readonly<Record<string, string | string[] | null | undefined>>;

/**
 * An action's `errors` in the shape Ouro UI's `Form` takes in its `errors` prop. Each message
 * lands on the field with that `name`. Spoonjoy's `general` message is Ouro's `form` key, which
 * shows at the top of the form. Empty entries are left out.
 *
 * Pass `fields`, a constant list of the form's field names, when the action also answers with
 * errors the form has no field for and the page shows elsewhere: only those names and `general`
 * reach the form. `Form` warns about a name none of its fields has.
 *
 * The result keeps its identity until the action returns new errors: `Form` treats a new object
 * as a new result, shows every message again and moves focus to the first field with one.
 */
export function useFormErrors(
  errors: ActionErrors | null | undefined,
  fields?: readonly string[],
): FormErrors | undefined {
  return useMemo(() => {
    if (!errors) return undefined;
    const formErrors: FormErrors = {};
    for (const [name, message] of Object.entries(errors)) {
      if (message === null || message === undefined || message.length === 0) continue;
      if (name === "general") formErrors.form = message;
      else if (!fields || fields.includes(name)) formErrors[name] = message;
    }
    return formErrors;
  }, [errors, fields]);
}

/**
 * One message about the whole form (an action that answers `{ error }`, with no field to put it
 * on) in the shape Ouro UI's `Form` takes: it shows at the top of the form.
 */
export function useFormMessage(message: string | null | undefined): FormErrors | undefined {
  return useMemo(() => (message ? { form: message } : undefined), [message]);
}
