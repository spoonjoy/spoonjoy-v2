"use client";

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type JSX, type ReactNode, type Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { contractWarnings, errorClass } from "~/components/ouro/field/field-styles";
import { cn } from "~/lib/ouro/cn";
import { useMergedRef } from "~/lib/ouro/refs";
import { FieldOwnerContext, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  acceptProblem,
  fileKey,
  formatSize,
  listClass,
  matchesAccept,
  nameClass,
  previewClass,
  promptClass,
  sizeClass,
  zoneClass,
} from "~/components/ouro/file-field/file-field-styles";

/** A file FileField left out, and why: it did not match `accept`, was larger than `maxSize`, or was one too many without `multiple`. */
export interface FileRejection {
  /** The file that was left out. */
  file: File;
  /** `type`: it does not match `accept`. `size`: it is larger than `maxSize`. `count`: the field takes one file. */
  reason: "type" | "size" | "count";
}

/** Props for {@link FileField}. */
export interface FileFieldProps {
  /**
   * What the files are for ("Recipe photo"), shown above the drop zone and read as the input's
   * name. Required: every control needs a name. To hide it visually, keep it and add `hideLabel`.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/file-field/file-field.test-d.ts verify:fileLine(registry/ouro/components/ouro/file-field/file-field.test-d.ts, /expectTypeOf<\{\saccept:\s"image\/\*"\s\}>\(\)\.not\.toExtend<FileFieldProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it. */
  hideLabel?: boolean | undefined;
  /**
   * Supporting text under the label ("PNG or JPG, up to 5 MB"), read through `aria-describedby`.
   *
   * @claim "), read through `aria-describedby`." registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > is a labeled native file input inside a drop zone, on the Field contract)
   */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. It shows under the field, and
   * the input gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** A file must be chosen before the form submits. */
  required?: boolean | undefined;
  /** Disables the input and the drop zone, and fades the field. */
  disabled?: boolean | undefined;
  /** The form field name the files submit under. */
  name?: string | undefined;
  /**
   * The files it takes, as the input's `accept`: extensions and MIME types, comma-separated
   * (`".pdf,image/*"`). Files that do not match are left out, with a message under the field,
   * and reported to `onReject`.
   */
  accept?: string | undefined;
  /**
   * Takes several files; each new choice or drop adds to the list. Without it, a new file replaces the old one.
   *
   * @claim "Takes several files; each new choice" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > adds files to the list with multiple, and replaces the file without it)
   */
  multiple?: boolean | undefined;
  /**
   * The largest file it takes, in bytes: `5 * 1024 * 1024` for 5 MB. Larger files are left out,
   * with a message under the field, and reported to `onReject`.
   * @claim "The largest file it takes, in" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > says why a file was left out, under the field > for a file larger than maxSize, naming the limit)
   */
  maxSize?: number | undefined;
  /** Called with the chosen files whenever the list changes: a choice, a drop, or a removal. */
  onFilesChange?: ((files: File[]) => void) | undefined;
  /**
   * Called with the files that were left out, and why. The field already says why under
   * itself; use this to log or count them.
   */
  onReject?: ((rejections: FileRejection[]) => void) | undefined;
  /**
   * The message under the field for each file that was left out, until the next choice takes
   * every file, a removal or a form reset. It is announced to screen readers as a status, and
   * shows next to `error` and a Form's error for this name, never instead of them. Translate it
   * with your app.
   * @default (rejection) => "notes.heic is not an accepted file type.", "big.png is larger than 5 MB." or "Only one file can be added, so b.png was left out."
   * @claim "The message under the field for" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > says why a file was left out, under the field > next to the app's own error, in rejectMessage's words, until the next choice takes every file)
   * @claim "The message under the field for" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > says why a file was left out, under the field > and drops the message when a file is removed or the form resets)
   * @claim "It is announced to screen readers" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > says why a file was left out, under the field > next to a Form's error for its name, which it does not hide)
   * @claim "It is announced to screen readers" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > says why a file was left out, under the field > in a polite status region, mounted before the rejection and emptied by the next valid pick)
   */
  rejectMessage?: ((rejection: FileRejection) => string) | undefined;
  /**
   * Which camera a phone opens instead of the file picker: `environment` (back) or `user` (front).
   * Pass it with `accept="image/*"`.
   */
  capture?: "user" | "environment" | undefined;
  /**
   * The text in the drop zone. Translate it with your app.
   * @default "Drag a file here, or choose one" ("Drag files here, or choose them" with `multiple`)
   */
  prompt?: string | undefined;
  /**
   * The start of each file's remove button name, followed by the file name, as visually
   * hidden text and not an `aria-label`, so a test's `getByLabel("Photo")` finds the field and
   * not "Remove photo.jpg". Translate it with your app.
   * @default "Remove"
   * @claim "The start of each file's remove" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > leaves a loose label lookup for the field on the input, not on a file's remove button)
   */
  removeLabel?: string | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`). Appearance classes warn in
   * development; style fields in your theme.
   */
  className?: string | undefined;
  /** The file input element. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. Ouro UI uses `maxSize`, in bytes: `<FileField maxSize={5 * 1024 * 1024}>`. */
  maxFileSize?: { 'Use <FileField maxSize={5 * 1024 * 1024}>': never };
  /** Not a prop. Ouro UI uses `accept`, as the input does: `<FileField accept="image/*,.pdf">`. */
  acceptedFileTypes?: { 'Use <FileField accept="image/*,.pdf">': never };
  /** Not a prop. Ouro UI uses `onFilesChange`, which gets the files: `<FileField onFilesChange={(files) => ...}>`. */
  onChange?: { 'Use <FileField onFilesChange={(files) => ...}>': never };
  /** Not a prop. Dropped files arrive in `onFilesChange`: `<FileField onFilesChange={(files) => ...}>`. */
  onDrop?: { 'Use <FileField onFilesChange={(files) => ...}>': never };
  /** Not a prop. Ouro UI uses `error`: `<FileField error="Choose a photo.">`. */
  errorMessage?: { 'Use <FileField error="Choose a photo.">': never };
  /** Not a prop. Ouro UI uses `description`: `<FileField description="...">`. */
  helperText?: { 'Use <FileField description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<FileField error="What is wrong">`. */
  isInvalid?: { 'Use <FileField error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<FileField error="What is wrong">`. */
  invalid?: { 'Use <FileField error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<FileField required>`. */
  isRequired?: { 'Use <FileField required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<FileField disabled>`. */
  isDisabled?: { 'Use <FileField disabled>': never };
}

/** Field's messages and root name FileField. */
const owner = { name: "FileField", data: "file-field" };

/** Icons drawn in the text color, like the other Ouro icons. */
function Icon({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * An image file's thumbnail. Its object URL lives as long as the element: it is made when the
 * image is attached and released when it is removed.
 */
function Thumbnail({ file }: { file: File }): JSX.Element {
  const attach = useCallback(
    (image: HTMLImageElement | null) => {
      /* istanbul ignore if @preserve -- React 19 calls a ref that returns a cleanup with the element only */
      if (!image) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
  return <img ref={attach} alt="" className={previewClass} />;
}

/** The English message for a file that was left out. */
function defaultRejectMessage({ file, reason }: FileRejection, maxSize: number | undefined): string {
  if (reason === "type") return `${file.name} is not an accepted file type.`;
  if (reason === "size") return `${file.name} is larger than ${formatSize(maxSize!)}.`;
  return `Only one file can be added, so ${file.name} was left out.`;
}

/** Puts files in the input, so the form submits exactly the listed ones. */
function setInputFiles(input: HTMLInputElement, files: readonly File[]): void {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  input.files = data.files;
}

/**
 * A labeled file input with a drop zone, on the Field contract. Files can be chosen with the
 * system picker (or a phone's camera, with `capture`) or dropped on the zone; the chosen ones
 * are listed with a thumbnail for images and a remove button, and they stay in the native
 * input, so a plain form submits them. `accept`, `maxSize` and `multiple` filter what comes
 * in; a file that is left out gets a message under the field (`rejectMessage` translates it),
 * and `onReject` reports it.
 *
 * Use `TextField type="url"` instead to take a link to a file, and an upload service's own
 * widget when files go straight to storage without a form.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/file-field
 *
 * @example
 * <FileField label="Recipe photo" name="photo" accept="image/*" maxSize={5 * 1024 * 1024} error={errors?.photo} />
 * <FileField label="Attachments" name="attachments" multiple maxSize={10 * 1024 * 1024} onReject={(rejected) => logRejected(rejected)} />
 */
export function FileField(props: FileFieldProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    accept,
    multiple,
    maxSize,
    onFilesChange,
    onReject,
    rejectMessage,
    capture,
    prompt,
    removeLabel = "Remove",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    maxFileSize,
    acceptedFileTypes,
    onChange,
    onDrop,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
  } = props;
  useDevWarnings(
    "FileField",
    process.env.NODE_ENV !== "production"
      ? () => {
          const bad = acceptProblem(accept);
          return [
            bad !== undefined && [
              `accept lists "${bad}", which is neither an extension nor a type`,
              `<FileField accept="${accept!.replace(bad, `.${bad}`)}">`,
            ],
            maxSize !== undefined &&
              !(maxSize > 0) && [`maxSize={${String(maxSize)}} is not a positive number of bytes`, "<FileField maxSize={5 * 1024 * 1024}>"],
            maxSize !== undefined &&
              maxSize > 0 &&
              maxSize < 1024 && [
                `maxSize={${maxSize}} is ${maxSize} bytes; maxSize counts bytes`,
                `<FileField maxSize={${maxSize} * 1024 * 1024}> for ${maxSize} MB`,
              ],
            ...contractWarnings("FileField", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
            maxFileSize !== undefined && ["maxFileSize is not a prop", `<FileField maxSize={${String(maxFileSize)}}>`],
            acceptedFileTypes !== undefined && [
              "acceptedFileTypes is not a prop",
              `<FileField accept="${([] as unknown[]).concat(acceptedFileTypes).join(",")}">`,
            ],
            onChange !== undefined && ["onChange is not a prop", "<FileField onFilesChange={(files) => …}>"],
            onDrop !== undefined && ["onDrop is not a prop; dropped files arrive in onFilesChange", "<FileField onFilesChange={(files) => …}>"],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = useMergedRef(ref, inputRef);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dragging, setDragging] = useState(false);
  // Why the last choice or drop left files out, shown under the field.
  const [rejections, setRejections] = useState<readonly string[]>([]);
  const statusId = useId();
  const rejecting = rejections.length > 0;

  // A form reset empties the input; empty the list and its messages with it.
  useEffect(() => {
    const form = inputRef.current!.form;
    if (!form) return;
    const onReset = () => {
      setFiles([]);
      setRejections([]);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  /** Shows a new list, puts it in the input and tells the app. */
  const commit = (next: readonly File[]) => {
    setInputFiles(inputRef.current!, next);
    setFiles(next);
    onFilesChange?.([...next]);
  };

  /** Takes files from the picker or a drop: filters them, then adds them or replaces the file. */
  const take = (incoming: readonly File[]) => {
    const rejected: FileRejection[] = [];
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!matchesAccept(file, accept)) rejected.push({ file, reason: "type" });
      else if (maxSize !== undefined && maxSize > 0 && file.size > maxSize) rejected.push({ file, reason: "size" });
      else if (!multiple && accepted.length > 0) rejected.push({ file, reason: "count" });
      else accepted.push(file);
    }
    setRejections(rejected.map((rejection) => (rejectMessage ? rejectMessage(rejection) : defaultRejectMessage(rejection, maxSize))));
    if (rejected.length > 0) onReject?.(rejected);
    if (accepted.length === 0) {
      // The picker put a rejected file in the input: put the listed ones back.
      setInputFiles(inputRef.current!, files);
      return;
    }
    if (!multiple) return commit(accepted);
    const seen = new Set(files.map(fileKey));
    commit([...files, ...accepted.filter((file) => !seen.has(fileKey(file)))]);
  };

  const remove = (file: File) => {
    setRejections([]);
    commit(files.filter((listed) => listed !== file));
    inputRef.current!.focus();
  };

  // Dropping a file anywhere in the zone must never open it in the browser, so these always
  // cancel the default; a disabled field ignores what is dropped.
  const dragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };
  const dragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take([...event.dataTransfer.files]);
  };

  return (
    <FieldOwnerContext.Provider value={owner}>
      <Field
        label={label}
        hideLabel={hideLabel}
        description={description}
        error={error}
        required={required}
        disabled={disabled}
        name={name}
        className={className}
      >
        {/* The zone is a label around the input, so pressing anywhere in it opens the picker, and
            its text counts as disabled with the input. The input's name stays the field's label
            (aria-labelledby). */}
        <label
          data-ouro-drop-zone=""
          data-dragging={dragging ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
          className={zoneClass}
          onDragEnter={dragOver}
          onDragOver={dragOver}
          onDragLeave={dragLeave}
          onDrop={drop}
        >
          <span className={promptClass}>
            <Icon>
              <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
            </Icon>
            {prompt ?? (multiple ? "Drag files here, or choose them" : "Drag a file here, or choose one")}
          </span>
          <FieldControl
            ref={setRef}
            accept={accept}
            multiple={multiple}
            capture={capture}
            onChange={(event) => take([...event.currentTarget.files!])}
            {...(rejecting ? { "aria-invalid": true, "aria-describedby": statusId } : {})}
            render={(controlProps) => <input {...controlProps} type="file" data-ouro-control="file-field" data-ouro-part="input" className="sr-only" />}
          />
        </label>
        {files.length > 0 && (
          <ul data-ouro-file-list="" className={listClass}>
            {files.map((file) => {
              return (
                <li key={fileKey(file)} className="m-0 flex min-w-0 items-center gap-3">
                  {file.type.startsWith("image/") ? (
                    <Thumbnail file={file} />
                  ) : (
                    <span aria-hidden="true" className={previewClass}>
                      <Icon>
                        <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5zM14 3.5V8h4.5" />
                      </Icon>
                    </span>
                  )}
                  <span className="grid min-w-0 flex-1">
                    <span data-ouro-file-name="" className={nameClass}>
                      {file.name}
                    </span>
                    <span data-ouro-file-size="" className={sizeClass}>
                      {formatSize(file.size)}
                    </span>
                  </span>
                  <Button
                    variant="plain"
                    tone="secondary"
                    size="sm"
                    data-ouro-file-remove=""
                    data-ouro-control="file-field"
                    data-ouro-part="remove"
                    disabled={disabled}
                    className="aspect-square px-0"
                    onClick={() => remove(file)}
                  >
                    <Icon className="size-4">
                      <path d="M7 7l10 10M17 7L7 17" />
                    </Icon>
                    <span className="sr-only">{`${removeLabel} ${file.name}`}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {/* Why files were left out: a polite status region from the first render, so screen
            readers announce the message once when it appears; hidden while empty. It stays apart
            from Field's error, so `error` and a Form's error still show. */}
        <div id={statusId} role="status" data-ouro-file-rejections="" className={cn(errorClass, !rejecting && "sr-only")}>
          {rejections.length > 1 ? (
            <ul className="m-0 list-none p-0">
              {rejections.map((message, index) => (
                // Two files can share a name, and so a message.
                <li key={`${index}:${message}`}>{message}</li>
              ))}
            </ul>
          ) : (
            rejections[0]
          )}
        </div>
      </Field>
    </FieldOwnerContext.Provider>
  );
}
