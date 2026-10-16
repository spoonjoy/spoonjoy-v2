import { useEffect, useId, useRef, useState } from "react";
import { Form, useNavigation, useSubmit } from "react-router";
import { ChevronDown, ImagePlus, Loader2, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
import { useActionWriteToken } from "~/hooks/use-write-token";
import { localDateTimeToIso } from "~/lib/cooked-at";
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

const PHOTO_STUDIO_INTENTS = ["createFirstPhotoCover"] as const;

export interface RecipePhotoStudioProps {
  recipeTitle: string;
  hasActiveCover: boolean;
  activeCoverProcessing?: {
    coverId: string;
    activeVariant: "image" | "stylized";
    targetVariant: "stylized";
    status: string;
    generationStatus: string;
  } | null;
}

export function RecipePhotoStudio({
  recipeTitle,
  hasActiveCover,
  activeCoverProcessing = null,
}: RecipePhotoStudioProps) {
  const photoId = useId();
  const photoHintId = useId();
  const photoStatusId = useId();
  const photoErrorId = useId();
  const submitInFlightRef = useRef(false);
  const navigation = useNavigation();
  const submit = useSubmit();
  // The same photo submitted again (after a 503 or a lost answer) makes one cover, not two.
  const coverToken = useActionWriteToken(PHOTO_STUDIO_INTENTS);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [postAsSpoon, setPostAsSpoon] = useState(true);
  const [generateEditorial, setGenerateEditorial] = useState(true);
  const [showSpoonDetails, setShowSpoonDetails] = useState(false);
  const [submitStarted, setSubmitStarted] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!photoFile || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  const isRouterPostingPhoto =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "createFirstPhotoCover";
  const isPosting = submitStarted || isRouterPostingPhoto;
  const statusLabel = activeCoverProcessing
    ? "Styling cover"
    : generateEditorial
      ? "Styling cover"
      : postAsSpoon
        ? "Saving cook photo"
        : "Saving cover photo";
  const showProgressStatus = isPosting || activeCoverProcessing !== null;
  const canSubmit = photoFile !== null && photoError === null && !isPosting;
  const titleLabel = hasActiveCover ? "Add cover photo" : "Add first photo";
  const photoDescription = photoFile ? photoFile.name : "No photo selected";
  const submitLabel = isPosting
    ? statusLabel
    : !photoFile
      ? "Save photo"
      : generateEditorial
        ? postAsSpoon ? "Save Spoon + cover" : "Save editorial cover"
        : postAsSpoon ? "Save Spoon photo" : "Save cover photo";

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
      // "Cooked at" is a wall-clock time with no timezone; send the instant it means in the
      // cook's own timezone (see ~/lib/cooked-at).
      const cookedAt = formData.get("cookedAt");
      if (typeof cookedAt === "string") formData.set("cookedAt", localDateTimeToIso(cookedAt));
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
            Photos
          </h3>
          <p className="font-sj-ui text-sm font-semibold text-[var(--sj-brass)]">
            {titleLabel}
          </p>
        </div>
        {showProgressStatus ? (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex min-h-7 items-center gap-2 border border-[var(--sj-brass)] px-2 font-sj-ui text-xs font-semibold text-[var(--sj-brass)]"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {statusLabel}
          </span>
        ) : null}
      </div>

      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-4 space-y-4"
        data-testid="recipe-photo-studio-form"
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="intent" value="createFirstPhotoCover" />
        <input type="hidden" name="coverToken" value={coverToken} />
        <input type="hidden" name="activateWhenReady" value="true" />
        {/* The photo picker is Spoonjoy's own control (a tile with a preview), so its label and
            error are plain elements, styled like Ouro UI's field label. */}
        <div className="grid gap-2">
          <label htmlFor={photoId} className="justify-self-start font-sj-ui text-sm/5 font-medium text-[var(--sj-ink)] select-none">
            Recipe photo
          </label>
          <label
            data-testid="recipe-photo-picker"
            className="group flex min-h-28 cursor-pointer items-center gap-4 border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 py-4 transition hover:border-[var(--sj-ink)] hover:bg-[var(--sj-panel-solid)]"
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
            <span className="grid size-20 shrink-0 place-items-center overflow-hidden bg-[var(--sj-ink)] text-[var(--sj-paper)] transition group-hover:bg-[var(--sj-action-deep)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--sj-brass)] sm:size-24">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  data-testid="recipe-photo-preview"
                />
              ) : (
                <ImagePlus className="size-6" aria-hidden="true" />
              )}
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
            <p id={photoErrorId} role="alert" className="m-0 text-sm/5 text-[var(--sj-tomato)]">
              {photoError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-y border-[var(--sj-border)] py-3 sm:border">
            <Checkbox
              label="Also log this as a cook"
              description="Keeps the photo as you took it, with your cook note."
              name="postAsSpoon"
              value="true"
              checked={postAsSpoon}
              onCheckedChange={setPostAsSpoon}
              disabled={isPosting}
            />
          </div>
          <div className="border-y border-[var(--sj-border)] py-3 sm:border">
            <Checkbox
              label="Make a styled cover"
              description="Makes a polished cover from your photo."
              name="generateEditorial"
              value="true"
              checked={generateEditorial}
              onCheckedChange={setGenerateEditorial}
              disabled={isPosting}
            />
          </div>
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
              Optional Spoon details
            </Button>
            {showSpoonDetails ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextArea
                  label="Note"
                  name="note"
                  rows={3}
                  placeholder="How did it go?"
                  disabled={isPosting}
                  className="sm:col-span-2"
                />
                <TextField
                  label="Next time"
                  name="nextTime"
                  placeholder="What would you change?"
                  disabled={isPosting}
                />
                {/* Ouro UI's TextField has no date-and-time type, so this is its Field and control. */}
                <Field label="Cooked at" name="cookedAt" disabled={isPosting}>
                  <FieldControl type="datetime-local" />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <TextField
          label="Editorial direction"
          description="Optional: say what should change while keeping the food recognizable."
          name="promptAddition"
          maxLength={240}
          placeholder="Brighter light, cleaner table, keep the plating"
          disabled={isPosting || !generateEditorial}
        />

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--sj-border)] pt-4">
          <Button type="submit" disabled={!canSubmit} aria-busy={isPosting ? "true" : undefined}>
            {isPosting ? (
              <Loader2 className="size-4 animate-spin" data-slot="icon" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" data-slot="icon" aria-hidden="true" />
            )}
            {submitLabel}
          </Button>
        </div>
      </Form>
    </section>
  );
}
