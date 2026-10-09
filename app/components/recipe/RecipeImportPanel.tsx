/**
 * RecipeImportPanel: the first choice on New Recipe.
 *
 * A cook brings in a recipe they already have, from a link or by pasting the recipe itself.
 * The form posts `intent=import` to the New Recipe action, which runs the shared import
 * pipeline and opens the imported recipe in the editor for review.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { Form, useNavigation } from "react-router";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Description, ErrorMessage, Field, Label } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Link } from "~/components/ui/link";

export type RecipeImportKind = "link" | "text";

export interface RecipeImportActionData {
  kind: RecipeImportKind;
  message: string;
  existingRecipe?: { id: string; title: string };
}

const TEXT_MAX_LENGTH = 20000;
const URL_MAX_LENGTH = 2048;

const KIND_OPTIONS: Array<{ kind: RecipeImportKind; label: string }> = [
  { kind: "link", label: "From a link" },
  { kind: "text", label: "Paste the recipe" },
];

function newImportId(): string {
  return crypto.randomUUID();
}

export function RecipeImportPanel({ result }: { result?: RecipeImportActionData }) {
  const navigation = useNavigation();
  const [kind, setKind] = useState<RecipeImportKind>(result?.kind ?? "link");
  const headingId = useId();
  // One id per distinct submission: a second submit of the same link or text reuses it, so the
  // server opens the recipe the first submit wrote instead of importing it twice.
  const lastSubmission = useRef<{ key: string; id: string } | null>(null);

  const pending =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "import";
  const showResult = result && result.kind === kind;

  const errorNode = showResult ? (
    <ErrorMessage>
      {result.message}
      {result.existingRecipe ? (
        <>
          {" "}
          <Link href={`/recipes/${result.existingRecipe.id}`} className="sj-link">
            Open it
          </Link>
        </>
      ) : null}
    </ErrorMessage>
  ) : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const value = (form.elements.namedItem(kind === "link" ? "url" : "text") as HTMLInputElement).value;
    const key = `${kind}:${value.trim()}`;
    if (lastSubmission.current?.key !== key) {
      lastSubmission.current = { key, id: newImportId() };
    }
    (form.elements.namedItem("importId") as HTMLInputElement).value = lastSubmission.current.id;
  };

  return (
    <section aria-labelledby={headingId} className="sj-form-section border-b border-[var(--sj-border)]">
      <p className="sj-eyebrow">Bring it in</p>
      <h2 id={headingId} className="font-sj-display mt-3 text-3xl/9 font-semibold tracking-normal text-[var(--sj-ink)]">
        Start from a recipe you already have.
      </h2>
      <p className="mt-2 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">
        Spoonjoy reads it into steps and ingredients, then opens it in the editor so you can check it over.
      </p>

      <div
        className="mt-6 grid max-w-xl grid-cols-2 border-y border-[var(--sj-border)] font-sj-ui text-xs font-bold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]"
        role="group"
        aria-label="How to bring the recipe in"
      >
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => setKind(option.kind)}
            aria-pressed={kind === option.kind}
            className={[
              "sj-instant-state min-h-11 px-3 first:text-left last:text-right",
              kind === option.kind
                ? "bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                : "bg-transparent hover:text-[var(--sj-ink)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Form method="post" onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4" aria-labelledby={headingId}>
        <input type="hidden" name="intent" value="import" />
        <input type="hidden" name="importKind" value={kind} />
        <input type="hidden" name="importId" defaultValue="" />
        {kind === "link" ? (
          <Field>
            <Label>Recipe link</Label>
            <Input
              key="url"
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              maxLength={URL_MAX_LENGTH}
              required
              disabled={pending}
              invalid={showResult || undefined}
            />
            <Description>Any recipe page, or a YouTube or TikTok video with the recipe in its description.</Description>
            {errorNode}
          </Field>
        ) : (
          <Field>
            <Label>Recipe text</Label>
            <Textarea
              key="text"
              name="text"
              rows={8}
              placeholder={"Title\n\nIngredients\n\nSteps"}
              maxLength={TEXT_MAX_LENGTH}
              required
              disabled={pending}
              invalid={showResult || undefined}
            />
            <Description>
              Paste the title, ingredients and steps. Have it on paper? On a phone, copy the text straight out of a photo of the page and paste it here.
            </Description>
            {errorNode}
          </Field>
        )}

        <Button type="submit" disabled={pending} aria-busy={pending ? "true" : undefined}>
          {pending ? <Loader2 className="size-4 animate-spin" data-slot="icon" /> : null}
          {pending ? "Reading the recipe…" : "Import recipe"}
        </Button>
      </Form>

      <p className="sj-eyebrow mt-8">Or write it yourself below</p>
    </section>
  );
}

/** Shown at the top of the editor right after an import, so the cook checks what was read. */
export function ImportedRecipeNotice({ sourceUrl }: { sourceUrl: string | null }) {
  let sourceHost: string | null = null;
  if (sourceUrl) {
    try {
      sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      sourceHost = null;
    }
  }
  return (
    <div
      role="status"
      className="mt-6 max-w-5xl border-y border-[var(--sj-brass)] py-4"
    >
      <p className="sj-eyebrow">
        Imported{sourceHost ? ` from ${sourceHost}` : ""}
      </p>
      <p className="mt-2 max-w-2xl text-sm/6 text-[var(--sj-ink)]">
        Here is what Spoonjoy read. Check the amounts and the steps, move any ingredient to the step that uses it, then save.
      </p>
    </div>
  );
}
