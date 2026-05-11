import { useEffect, useId, useRef, useState } from "react";
import { Form } from "react-router";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "../ui/dialog";
import { Field, Label } from "../ui/fieldset";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";

const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024;
const RECIPE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PHOTO_TYPE_MESSAGE = "Photos must be jpg, png, gif, or webp.";
const PHOTO_SIZE_MESSAGE = "Photos must be 5 MB or smaller.";

function validateClientFile(file: File): string | null {
  if (!(RECIPE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return PHOTO_TYPE_MESSAGE;
  }
  if (file.size > IMAGE_MAX_FILE_SIZE) {
    return PHOTO_SIZE_MESSAGE;
  }
  return null;
}

export interface SpoonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  actionUrl: string;
  isOriginCookCandidate: boolean;
  errorMessage?: string | null;
}

export function SpoonDialog({
  isOpen,
  onClose,
  actionUrl,
  isOriginCookCandidate,
  errorMessage,
}: SpoonDialogProps) {
  const noteId = useId();
  const nextTimeId = useId();
  const photoId = useId();
  const cookedAtId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [note, setNote] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [cookedAt, setCookedAt] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setNote("");
      setNextTime("");
      setCookedAt("");
      setPhotoFile(null);
      setPhotoError(null);
    }
  }, [isOpen]);

  const hasContent = note.trim() !== "" || nextTime.trim() !== "" || photoFile !== null;
  const requiresPhoto = isOriginCookCandidate;
  const canSubmit = hasContent && (!requiresPhoto || photoFile !== null) && photoError === null;

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
      return;
    }
    setPhotoError(null);
    setPhotoFile(file);
  }

  return (
    <Dialog open={isOpen} onClose={onClose} size="md">
      <DialogTitle>Log a cook</DialogTitle>
      <DialogBody className="mt-4">
        <Form
          ref={formRef}
          method="post"
          action={actionUrl}
          encType="multipart/form-data"
          className="space-y-4"
        >
          <input type="hidden" name="intent" value="createSpoon" />
          {requiresPhoto ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Photo required for your own cook.
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage}
            </p>
          ) : null}
          <Field>
            <Label htmlFor={photoId}>Photo</Label>
            <input
              id={photoId}
              name="photo"
              type="file"
              accept={RECIPE_IMAGE_TYPES.join(",")}
              data-max-size={IMAGE_MAX_FILE_SIZE}
              onChange={handleFileChange}
              className="block w-full text-sm"
            />
            {photoError ? (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {photoError}
              </p>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={noteId}>Note</Label>
            <Textarea
              id={noteId}
              name="note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="How did it go?"
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
            />
          </Field>
          <DialogActions>
            <Button plain type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Save spoon
            </Button>
          </DialogActions>
        </Form>
      </DialogBody>
    </Dialog>
  );
}
