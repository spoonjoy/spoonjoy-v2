import { useEffect, useId, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { ImagePlus, Loader2 } from "lucide-react";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "../ui/dialog";
import { Field, Label } from "../ui/fieldset";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Checkbox, CheckboxField } from "../ui/checkbox";
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

/* istanbul ignore next -- @preserve backdrop closes are intentionally ignored while a post is in flight */
function ignoreCloseWhilePosting() {}

export interface SpoonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  actionUrl: string;
  isOriginCookCandidate: boolean;
  coverPromptMode?: "none" | "first-photo" | "optional-update";
  errorMessage?: string | null;
}

export function SpoonDialog({
  isOpen,
  onClose,
  actionUrl,
  isOriginCookCandidate,
  coverPromptMode = "none",
  errorMessage,
}: SpoonDialogProps) {
  const noteId = useId();
  const nextTimeId = useId();
  const photoId = useId();
  const photoHintId = useId();
  const photoStatusId = useId();
  const photoErrorId = useId();
  const cookedAtId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submitInFlightRef = useRef(false);
  const navigation = useNavigation();
  const [note, setNote] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [cookedAt, setCookedAt] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [useAsRecipeCover, setUseAsRecipeCover] = useState(false);
  const [submitStarted, setSubmitStarted] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setNote("");
      setNextTime("");
      setCookedAt("");
      setPhotoFile(null);
      setPhotoError(null);
      setUseAsRecipeCover(false);
      setSubmitStarted(false);
      submitInFlightRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!photoFile) {
      setUseAsRecipeCover(false);
    }
  }, [photoFile]);

  useEffect(() => {
    if (navigation.state === "idle") {
      setSubmitStarted(false);
      submitInFlightRef.current = false;
    }
  }, [navigation.state]);

  const isRouterPostingSpoon =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "createSpoon";
  const isPosting = submitStarted || isRouterPostingSpoon;
  const hasContent = note.trim() !== "" || nextTime.trim() !== "" || photoFile !== null;
  const hasValidContent = hasContent && photoError === null;
  const canSubmit = hasValidContent && !isPosting;
  const submitStatus = photoFile ? "Uploading photo..." : "Saving spoon...";
  const dialogOnClose = isPosting ? ignoreCloseWhilePosting : onClose;
  const showFirstPhotoCoverPrompt = coverPromptMode === "first-photo";
  const showCoverOptIn = coverPromptMode === "optional-update" && photoFile !== null;

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
    setPhotoError(null);
    setPhotoFile(file);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!hasValidContent || submitInFlightRef.current) {
      event.preventDefault();
      return;
    }

    submitInFlightRef.current = true;
    setSubmitStarted(true);
  }

  return (
    <Dialog open={isOpen} onClose={dialogOnClose} size="md">
      <DialogTitle>Log a cook</DialogTitle>
      <DialogBody className="mt-4">
        <Form
          ref={formRef}
          method="post"
          action={actionUrl}
          encType="multipart/form-data"
          className="space-y-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="intent" value="createSpoon" />
          {showFirstPhotoCoverPrompt ? (
            <p className="text-sm text-[var(--sj-brass)]">
              Add a photo to create the recipe cover
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="text-sm text-[var(--sj-tomato)]">
              {errorMessage}
            </p>
          ) : null}
          <Field>
            <Label htmlFor={photoId}>Photo</Label>
            <label
              data-slot="control"
              data-testid="spoon-photo-picker"
              className="group flex min-h-24 cursor-pointer items-center gap-4 rounded-[var(--sj-radius-surface)] border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 py-4 transition hover:border-[var(--sj-ink)] hover:bg-[var(--sj-panel-solid)]"
            >
              <input
                id={photoId}
                name="photo"
                type="file"
                accept={FOOD_IMAGE_ACCEPT}
                data-max-size={IMAGE_MAX_FILE_SIZE}
                aria-describedby={`${photoHintId} ${photoStatusId}${photoError ? ` ${photoErrorId}` : ""}`}
                onChange={handleFileChange}
                disabled={isPosting}
                className="peer sr-only"
              />
              <span className="grid size-12 shrink-0 place-items-center rounded-[var(--sj-radius-small)] bg-[var(--sj-ink)] text-[var(--sj-paper)] transition group-hover:bg-[var(--sj-action-deep)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--sj-brass)]">
                <ImagePlus className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-sj-ui text-base font-semibold leading-6 text-[var(--sj-ink)]">
                  Add photo
                </span>
                <span id={photoStatusId} className="block truncate font-sj-ui text-sm leading-6 text-[var(--sj-ink-soft)]">
                  {photoFile ? photoFile.name : "No photo yet"}
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
          {showCoverOptIn ? (
            <CheckboxField>
              <Checkbox
                name="useAsRecipeCover"
                value="true"
                checked={useAsRecipeCover}
                onChange={setUseAsRecipeCover}
                disabled={isPosting}
              />
              <Label>Use this photo as recipe cover</Label>
            </CheckboxField>
          ) : null}
          <Field>
            <Label htmlFor={noteId}>Note</Label>
            <Textarea
              id={noteId}
              name="note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
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
              value={nextTime}
              onChange={(event) => setNextTime(event.target.value)}
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
              value={cookedAt}
              onChange={(event) => setCookedAt(event.target.value)}
              disabled={isPosting}
            />
          </Field>
          {isPosting ? (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-[var(--sj-ink-soft)]"
            >
              <Loader2 className="size-4 animate-spin text-[var(--sj-brass)]" aria-hidden="true" />
              {submitStatus}
            </p>
          ) : null}
          <DialogActions>
            <Button plain type="button" onClick={onClose} disabled={isPosting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} aria-busy={isPosting ? "true" : undefined}>
              {isPosting ? (
                <Loader2 className="size-4 animate-spin" data-slot="icon" aria-hidden="true" />
              ) : null}
              {isPosting ? submitStatus : "Save spoon"}
            </Button>
          </DialogActions>
        </Form>
      </DialogBody>
    </Dialog>
  );
}
