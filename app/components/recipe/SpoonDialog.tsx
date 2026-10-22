import { useEffect, useRef, useState } from "react";
import { Form as RouterForm, useNavigation } from "react-router";
import { Loader2 } from "lucide-react";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Button } from "../button";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { FileField } from "~/components/ouro/file-field/file-field";
import { Form, type ReadonlyFormErrors } from "~/components/ouro/form/form";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
import {
  FOOD_IMAGE_ACCEPT,
  FOOD_IMAGE_SIZE_MESSAGE,
  FOOD_IMAGE_TYPE_MESSAGE,
  IMAGE_MAX_FILE_SIZE,
} from "~/lib/recipe-image";
import { localDateTimeToIso } from "~/lib/cooked-at";
import { claim } from "~/lib/ouro/claims";

/* istanbul ignore next -- @preserve backdrop closes are intentionally ignored while a post is in flight */
function ignoreCloseWhilePosting() {}

export interface SpoonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  actionUrl: string;
  isOriginCookCandidate: boolean;
  coverPromptMode?: "none" | "first-photo" | "optional-update";
  /** Messages bound to this dialog's actual accepted response with formErrors. */
  errors?: ReadonlyFormErrors;
}

export function SpoonDialog({
  isOpen,
  onClose,
  actionUrl,
  isOriginCookCandidate,
  coverPromptMode = "none",
  errors: formErrors,
}: SpoonDialogProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitInFlightRef = useRef(false);
  const navigation = useNavigation();
  const [note, setNote] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [cookedAt, setCookedAt] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [useAsRecipeCover, setUseAsRecipeCover] = useState(false);
  const [submitStarted, setSubmitStarted] = useState(false);
  // One cook per opening of the dialog: a resubmit (after the server could not save it, or a
  // double tap) carries the same token, and the server logs one cook for it. It is made when the
  // dialog opens, in the browser, never during server rendering.
  const [spoonToken, setSpoonToken] = useState("");

  useEffect(() => {
    if (isOpen) setSpoonToken(crypto.randomUUID());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setNote("");
      setNextTime("");
      setCookedAt("");
      setPhotoFile(null);
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
  const canSubmit = hasContent && !isPosting;
  const submitStatus = photoFile ? "Uploading photo..." : "Saving spoon...";
  const dialogOnClose = isPosting ? ignoreCloseWhilePosting : onClose;
  const showFirstPhotoCoverPrompt = coverPromptMode === "first-photo";
  const showCoverOptIn = coverPromptMode === "optional-update" && photoFile !== null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!hasContent || submitInFlightRef.current) {
      event.preventDefault();
      return;
    }

    submitInFlightRef.current = true;
    setSubmitStarted(true);
  }

  return (
    <Dialog open={isOpen} onOpenChange={dialogOnClose} size="md" title="Log a cook">
        <Form
          ref={formRef}
          method="post"
          action={actionUrl}
          encType="multipart/form-data"
          errors={formErrors}
          render={<RouterForm />}
          className="gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="intent" value="createSpoon" />
          <input type="hidden" name="spoonToken" value={spoonToken} />
          {/* The field below is a wall-clock time with no timezone; this sends the instant it means
              in the cook's own timezone (see ~/lib/cooked-at). */}
          <input type="hidden" name="cookedAt" value={localDateTimeToIso(cookedAt)} />
          {showFirstPhotoCoverPrompt ? (
            <p className="text-sm text-[var(--sj-brass)]">
              Add a photo to create the recipe cover
            </p>
          ) : null}
          <FileField
            label="Photo"
            name="photo"
            accept={FOOD_IMAGE_ACCEPT}
            maxSize={IMAGE_MAX_FILE_SIZE}
            description={claim("JPG, PNG, or WebP. 5 MB max.", { source: { file: "app/lib/recipe-image.ts" }, verify: [{ fileLine: "app/lib/recipe-image.ts", pattern: "IMAGE_MAX_FILE_SIZE = 5 \\* 1024 \\* 1024" }] })}
            rejectMessage={(rejection) =>
              rejection.reason === "size" ? FOOD_IMAGE_SIZE_MESSAGE : FOOD_IMAGE_TYPE_MESSAGE
            }
            onFilesChange={(files) => setPhotoFile(files[0] ?? null)}
            disabled={isPosting}
          />
          {showCoverOptIn ? (
            <Checkbox
              label="Use this photo as recipe cover"
              name="useAsRecipeCover"
              value="true"
              checked={useAsRecipeCover}
              onCheckedChange={setUseAsRecipeCover}
              disabled={isPosting}
            />
          ) : null}
          <TextArea
            label="Note"
            name="note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="How did it go?"
            disabled={isPosting}
          />
          <TextField
            label="Next time"
            name="nextTime"
            value={nextTime}
            onChange={(event) => setNextTime(event.target.value)}
            placeholder="What would you change?"
            disabled={isPosting}
          />
          {/* Ouro UI's TextField has no date-and-time type, so this is its Field and control. The
              field has no name: the hidden cookedAt input above carries the instant. */}
          <Field label="Cooked at" disabled={isPosting}>
            <FieldControl
              type="datetime-local"
              value={cookedAt}
              onChange={(event) => setCookedAt(event.target.value)}
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
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button plain type="button" onClick={onClose} disabled={isPosting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} aria-busy={isPosting ? "true" : undefined}>
              {isPosting ? (
                <Loader2 className="size-4 animate-spin" data-slot="icon" aria-hidden="true" />
              ) : null}
              {isPosting ? submitStatus : "Log cook"}
            </Button>
          </div>
        </Form>
    </Dialog>
  );
}
