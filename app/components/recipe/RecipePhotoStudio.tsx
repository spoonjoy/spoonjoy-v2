import { useEffect, useId, useRef, useState } from "react";
import { Form, useNavigation, useSubmit } from "react-router";
import { ChevronDown, ImagePlus, Loader2, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox, CheckboxField } from "~/components/ui/checkbox";
import { Field, Label } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  FOOD_IMAGE_ACCEPT,
  FOOD_IMAGE_SIZE_MESSAGE,
  FOOD_IMAGE_TYPE_MESSAGE,
  FOOD_IMAGE_TYPES,
  IMAGE_MAX_FILE_SIZE,
} from "~/lib/recipe-image";

function validateClientFile(file: File): string | null {
  if (!(FOOD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return FOOD_IMAGE_TYPE_MESSAGE;
  }
  if (file.size > IMAGE_MAX_FILE_SIZE) {
    return FOOD_IMAGE_SIZE_MESSAGE;
  }
  return null;
}

export interface RecipePhotoStudioProps {
  recipeTitle: string;
  hasActiveCover: boolean;
}

export function RecipePhotoStudio({
  recipeTitle,
  hasActiveCover,
}: RecipePhotoStudioProps) {
  const photoId = useId();
  const photoHintId = useId();
  const photoStatusId = useId();
  const photoErrorId = useId();
  const noteId = useId();
  const nextTimeId = useId();
  const cookedAtId = useId();
  const promptAdditionId = useId();
  const submitInFlightRef = useRef(false);
  const navigation = useNavigation();
  const submit = useSubmit();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [postAsSpoon, setPostAsSpoon] = useState(true);
  const [generateEditorial, setGenerateEditorial] = useState(true);
  const [showSpoonDetails, setShowSpoonDetails] = useState(false);
  const [submitStarted, setSubmitStarted] = useState(false);

  useEffect(() => {
    if (!postAsSpoon) {
      setShowSpoonDetails(false);
    }
  }, [postAsSpoon]);

  useEffect(() => {
    if (navigation.state === "idle") {
      submitInFlightRef.current = false;
      setSubmitStarted(false);
    }
  }, [navigation.state]);

  const isRouterPostingPhoto =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "createFirstPhotoCover";
  const isPosting = submitStarted || isRouterPostingPhoto;
  const canSubmit = photoFile !== null && photoError === null && !isPosting;
  const titleLabel = hasActiveCover ? "Add cover photo" : "Add first photo";
  const photoDescription = photoFile ? photoFile.name : "No photo selected";

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      setPhotoError(null);
      return;
    }

    const validation = validateClientFile(file);
    if (validation) {
      setPhotoError(validation);
      setPhotoFile(null);
      event.currentTarget.value = "";
      return;
    }

    setPhotoFile(file);
    setPhotoError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!canSubmit || submitInFlightRef.current) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("photo", photoFile);
    formData.set("activateWhenReady", "true");
    if (postAsSpoon) {
      formData.set("postAsSpoon", "true");
    } else {
      formData.delete("postAsSpoon");
      formData.delete("note");
      formData.delete("nextTime");
      formData.delete("cookedAt");
    }
    if (generateEditorial) {
      formData.set("generateEditorial", "true");
    } else {
      formData.delete("generateEditorial");
      formData.delete("promptAddition");
    }

    submitInFlightRef.current = true;
    setTimeout(() => setSubmitStarted(true), 0);
    submit(formData, { method: "post", encType: "multipart/form-data" });
  }

  return (
    <section
      aria-labelledby="recipe-photo-studio-heading"
      className="border-t border-[var(--sj-border)] pt-5"
      data-testid="recipe-photo-studio"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="recipe-photo-studio-heading"
            className="font-sj-display text-xl font-semibold leading-7 text-[var(--sj-ink)]"
          >
            Photo studio
          </h3>
          <p className="font-sj-ui text-sm font-semibold text-[var(--sj-brass)]">
            {titleLabel}
          </p>
        </div>
        {isPosting ? (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex min-h-7 items-center gap-2 border border-[var(--sj-brass)] px-2 font-sj-ui text-xs font-semibold text-[var(--sj-brass)]"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Editorializing
          </span>
        ) : null}
      </div>

      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-4 space-y-4"
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="intent" value="createFirstPhotoCover" />
        <input type="hidden" name="activateWhenReady" value="true" />
        <Field>
          <Label htmlFor={photoId}>Recipe photo</Label>
          <label
            data-slot="control"
            data-testid="recipe-photo-picker"
            className="group flex min-h-24 cursor-pointer items-center gap-4 border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 py-4 transition hover:border-[var(--sj-ink)] hover:bg-[var(--sj-panel-solid)]"
          >
            <input
              id={photoId}
              name="photo"
              type="file"
              accept={FOOD_IMAGE_ACCEPT}
              data-max-size={IMAGE_MAX_FILE_SIZE}
              aria-describedby={`${photoHintId} ${photoStatusId}${photoError ? ` ${photoErrorId}` : ""}`}
              onChange={handleFileChange}
              className="peer sr-only"
            />
            <span className="grid size-12 shrink-0 place-items-center bg-[var(--sj-ink)] text-[var(--sj-paper)] transition group-hover:bg-[var(--sj-action-deep)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--sj-brass)]">
              <ImagePlus className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-sj-ui text-base font-semibold leading-6 text-[var(--sj-ink)]">
                {recipeTitle}
              </span>
              <span id={photoStatusId} className="block truncate font-sj-ui text-sm leading-6 text-[var(--sj-ink-soft)]">
                {photoDescription}
              </span>
              <span id={photoHintId} className="block font-sj-ui text-sm leading-6 text-[var(--sj-ink-soft)]">
                JPG, PNG, or WebP. 5 MB max.
              </span>
            </span>
          </label>
          {photoError ? (
            <p id={photoErrorId} role="alert" className="mt-1 text-sm text-[var(--sj-tomato)]">
              {photoError}
            </p>
          ) : null}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <CheckboxField className="border-y border-[var(--sj-border)] py-3 sm:border">
            <Checkbox
              name="postAsSpoon"
              value="true"
              checked={postAsSpoon}
              onChange={setPostAsSpoon}
              disabled={isPosting}
            />
            <Label>Post as Spoon</Label>
          </CheckboxField>
          <CheckboxField className="border-y border-[var(--sj-border)] py-3 sm:border">
            <Checkbox
              name="generateEditorial"
              value="true"
              checked={generateEditorial}
              onChange={setGenerateEditorial}
              disabled={isPosting}
            />
            <Label>Editorialize cover</Label>
          </CheckboxField>
        </div>

        {postAsSpoon ? (
          <div className="space-y-3">
            <Button
              type="button"
              plain
              aria-expanded={showSpoonDetails}
              onClick={() => setShowSpoonDetails((visible) => !visible)}
              disabled={isPosting}
            >
              <ChevronDown
                className={`size-4 transition ${showSpoonDetails ? "rotate-180" : ""}`}
                data-slot="icon"
                aria-hidden="true"
              />
              Spoon details
            </Button>
            {showSpoonDetails ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <Label htmlFor={noteId}>Note</Label>
                  <Textarea
                    id={noteId}
                    name="note"
                    rows={3}
                    placeholder="How did it go?"
                    disabled={isPosting}
                  />
                </Field>
                <Field>
                  <Label htmlFor={nextTimeId}>Next time</Label>
                  <Input
                    id={nextTimeId}
                    name="nextTime"
                    type="text"
                    placeholder="What would you change?"
                    disabled={isPosting}
                  />
                </Field>
                <Field>
                  <Label htmlFor={cookedAtId}>Cooked at</Label>
                  <Input
                    id={cookedAtId}
                    name="cookedAt"
                    type="datetime-local"
                    disabled={isPosting}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <Field>
          <Label htmlFor={promptAdditionId}>Editorial direction</Label>
          <Input
            id={promptAdditionId}
            name="promptAddition"
            type="text"
            maxLength={240}
            placeholder="Brighter light, cleaner table, keep the plating"
            disabled={isPosting || !generateEditorial}
          />
        </Field>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--sj-border)] pt-4">
          <Button type="submit" disabled={!canSubmit} aria-busy={isPosting ? "true" : undefined}>
            {isPosting ? (
              <Loader2 className="size-4 animate-spin" data-slot="icon" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" data-slot="icon" aria-hidden="true" />
            )}
            Save photo
          </Button>
        </div>
      </Form>
    </section>
  );
}
