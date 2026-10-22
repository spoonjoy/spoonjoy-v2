"use client";

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { errorMessages, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { Button } from "~/components/ouro/button/button";
import { formatSize, matchesAccept } from "~/components/ouro/file-field/file-field-styles";
import { ImageCropper } from "~/components/ouro/image-cropper/image-cropper";

/** How {@link ImageField} crops a chosen photo. */
export interface ImageFieldCrop {
  /** The saved image's width in pixels. @default 1024 */
  outputWidth?: number | undefined;
  /** The saved image's format. @default "image/jpeg" */
  type?: "image/jpeg" | "image/png" | "image/webp" | undefined;
  /** The cropper's title. @default "Crop photo" */
  title?: string | undefined;
}

/** Why a chosen file was turned away: not a type `accept` takes, over `maxSize`, or a photo the browser cannot open (such as HEIC outside Safari). */
export type ImageFieldRejection = "type" | "size" | "unreadable";

/** Props for {@link ImageField}. */
export interface ImageFieldProps {
  /** What the image is, above it and naming the field: "Profile photo". */
  label: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, such as the formats and size it takes. */
  description?: ReactNode | undefined;
  /** What is wrong, shown under the field in the destructive tone. */
  error?: ReadonlyErrorMessages | undefined;
  /** Marks the field as required: a mark after the label. Check that a photo was chosen when the form submits. */
  required?: boolean | undefined;
  /** Turns the field off. */
  disabled?: boolean | undefined;
  /** The form field name the chosen (and cropped) photo submits under. */
  name?: string | undefined;
  /** The photo the field shows until another is chosen, such as the one already saved. */
  src?: string | null | undefined;
  /** The photo's text alternative while it shows `src`. @default "" (the label names it) */
  alt?: string | undefined;
  /** The types it takes, as the file input's `accept`. @default "image/*" */
  accept?: string | undefined;
  /**
   * The largest file it takes, in bytes.
   *
   * @claim "The largest file it takes, in" registry/ouro/components/ouro/image-field/image-field.test.tsx verify:testExists(registry/ouro/components/ouro/image-field/image-field.test.tsx::ImageField > turns away a file that is not an image or is too large, keeping what showed, and says why)
   */
  maxSize?: number | undefined;
  /** The preview's width divided by its height, and the crop's. @default 1 */
  aspect?: number | undefined;
  /** `circle` shows and crops a round photo, for a profile; `rect` a rounded rectangle. @default "rect" */
  shape?: "rect" | "circle" | (string & { 'Use "rect" or "circle"': never }) | undefined;
  /**
   * Opens the cropper on every chosen photo, so it fits `aspect` and `shape`: `crop` or `crop={{ outputWidth: 512 }}`.
   *
   * @claim "Opens the cropper on every chosen" registry/ouro/components/ouro/image-field/image-field.test.tsx verify:testExists(registry/ouro/components/ouro/image-field/image-field.test.tsx::ImageField > crops a chosen photo first with crop, and keeps the field as it was when the crop is cancelled)
   * @claim "Opens the cropper on every chosen" registry/ouro/components/ouro/image-field/image-field.test.tsx verify:testExists(registry/ouro/components/ouro/image-field/image-field.test.tsx::ImageField > crops with the defaults when crop is true)
   */
  crop?: boolean | ImageFieldCrop | undefined;
  /** Called with the chosen photo (cropped, with `crop`), or `null` when it is removed. A photo comes here once the browser has opened it. */
  onFileChange?: ((file: File | null) => void) | undefined;
  /** Shows Remove while the field shows `src`, and is called when the person removes it. */
  onRemove?: (() => void) | undefined;
  /** The message for a file turned away, for apps in other languages. */
  rejectMessage?: ((reason: ImageFieldRejection, file: File) => string) | undefined;
  /**
   * The choose button's label while no photo shows. @default "Choose photo"
   *
   * @claim "The choose button's label while no" registry/ouro/components/ouro/image-field/image-field.test.tsx verify:testExists(registry/ouro/components/ouro/image-field/image-field.test.tsx::ImageField > is a group named by its label, with a placeholder, Choose photo and a hidden file input)
   */
  chooseLabel?: string | undefined;
  /** The choose button's label while a photo shows. @default "Change photo" */
  changeLabel?: string | undefined;
  /** The remove button's label. @default "Remove" */
  removeLabel?: string | undefined;
  /** Layout only: margins, width (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the file input. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. The photo shown is `src`: `<ImageField src={user.photoUrl} />`. */
  value?: { 'Use src={photoUrl}; the chosen file comes to onFileChange': never };
  /** Not a prop. The photo shown is `src`: `<ImageField src={user.photoUrl} />`. */
  defaultValue?: { 'Use src={photoUrl}': never };
  /** Not a prop. Ouro UI says `onFileChange`: `<ImageField onFileChange={setPhoto} />`. */
  onChange?: { 'Use onFileChange={(file) => ...}': never };
  /** Not a prop. Ouro UI says `maxSize`, in bytes: `<ImageField maxSize={5 * 1024 * 1024} />`. */
  maxFileSize?: { 'Use maxSize={5 * 1024 * 1024}': never };
  /** Not a prop. Ouro UI says `crop`: `<ImageField crop />`. */
  cropper?: { 'Use crop or crop={{ outputWidth: 512 }}': never };
}

function PhotoIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-8">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </svg>
  );
}

/**
 * Puts one file in the input, or none, so the form submits exactly what shows.
 *
 * @claim "Puts one file in the input" registry/ouro/components/ouro/image-field/image-field.test.tsx verify:testExists(registry/ouro/components/ouro/image-field/image-field.test.tsx::ImageField > previews a chosen photo, puts it in the form, and removes it again)
 */
function setInputFile(input: HTMLInputElement, file: File | null): void {
  const data = new DataTransfer();
  if (file) data.items.add(file);
  input.files = data.files;
}

/**
 * A field for one photo, shown large: the photo already saved (`src`) or the one just chosen,
 * with Choose photo (Change photo once one shows) and Remove. With `crop`, a chosen photo
 * opens the cropper first, and the cropped image is what shows, what `onFileChange` gets and
 * what the form submits. A file of the wrong type, over `maxSize` or that the browser cannot
 * open as a photo is turned away, keeping what showed, with a message under the field that
 * screen readers announce. The photo is in a real file input, so a plain form submits it.
 *
 * Use `FileField` instead for other files, several files or a drop zone, and `ImageCropper`
 * alone to crop an image you already have.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/image-field
 *
 * @example
 * <ImageField label="Profile photo" name="photo" src={user.photoUrl} shape="circle" crop maxSize={5 * 1024 * 1024} onRemove={removePhoto} />
 */
export function ImageField(props: ImageFieldProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    src,
    alt = "",
    accept = "image/*",
    maxSize,
    aspect: aspectProp = 1,
    shape: shapeProp = "rect",
    crop,
    onFileChange,
    onRemove,
    rejectMessage,
    chooseLabel = "Choose photo",
    changeLabel = "Change photo",
    removeLabel = "Remove",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    value,
    defaultValue,
    onChange,
    maxFileSize,
    cropper,
  } = props;
  const aspect = aspectProp > 0 && Number.isFinite(aspectProp) ? aspectProp : 1;
  const shape = shapeProp === "circle" ? "circle" : "rect";
  useAppearanceClassNameCheck(
    "ImageField",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; ImageField sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ImageField",
    process.env.NODE_ENV !== "production"
      ? () => [
          aspect !== aspectProp && [`aspect={${String(aspectProp)}} is not a ratio; it is the width over the height, above 0`, "<ImageField aspect={16 / 9} />"],
          shape !== shapeProp && [`shape="${String(shapeProp)}" is not a shape; use "rect" or "circle"`, '<ImageField shape="circle" />'],
          value !== undefined && ["value is not a prop; the photo shown is src", "<ImageField src={photoUrl} onFileChange={setPhoto} />"],
          defaultValue !== undefined && ["defaultValue is not a prop", "<ImageField src={photoUrl} />"],
          onChange !== undefined && ["onChange is not a prop", "<ImageField onFileChange={(file) => {}} />"],
          maxFileSize !== undefined && ["maxFileSize is not a prop", `<ImageField maxSize={${typeof maxFileSize === "number" ? maxFileSize : "5 * 1024 * 1024"}} />`],
          cropper !== undefined && ["cropper is not a prop", "<ImageField crop />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  // Counts the checks that open a chosen photo, so only the newest one, while mounted, takes effect.
  const check = useRef(0);
  // The frame that shows a turned-away file's message, after the status region has emptied.
  const frame = useRef(0);
  useEffect(
    () => () => {
      check.current++;
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const attach = useCallback(
    (image: HTMLImageElement | null) => {
      /* istanbul ignore if @preserve -- React 19 calls a ref that returns a cleanup with the element only */
      if (!image || !file) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );

  const take = (next: File | null) => {
    setInputFile(input.current!, next);
    setFile(next);
    onFileChange?.(next);
  };
  const turnAway = (reason: ImageFieldRejection, chosen: File) => {
    const fallback = () =>
      reason === "type" ? `${chosen.name} is not an image this field takes.` : reason === "size" ? `${chosen.name} is larger than ${formatSize(maxSize!)}.` : `${chosen.name} could not be opened as a photo.`;
    setRejection(rejectMessage ? rejectMessage(reason, chosen) : fallback());
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    const ticket = ++check.current;
    cancelAnimationFrame(frame.current);
    // The input keeps what showed before until the photo is opened (and, with crop, cropped).
    setInputFile(event.target, file);
    // Empty the status region first, so the same message for the same file is announced again.
    setRejection(null);
    const reason: ImageFieldRejection | null = !matchesAccept(chosen, accept) ? "type" : maxSize !== undefined && chosen.size > maxSize ? "size" : null;
    if (reason) {
      frame.current = requestAnimationFrame(() => turnAway(reason, chosen));
      return;
    }
    if (crop) {
      // The cropper opens the photo and says when it cannot.
      setPending(chosen);
      return;
    }
    const url = URL.createObjectURL(chosen);
    const probe = new Image();
    probe.src = url;
    const opened = (ok: boolean) => {
      URL.revokeObjectURL(url);
      if (ticket !== check.current) return;
      if (ok) take(chosen);
      else turnAway("unreadable", chosen);
    };
    probe.decode().then(
      () => opened(true),
      () => opened(false),
    );
  };
  const remove = () => {
    check.current++;
    cancelAnimationFrame(frame.current);
    setRejection(null);
    if (file) take(null);
    else onRemove?.();
  };

  const showing = file !== null || Boolean(src);
  const errors = errorMessages(error);
  const invalid = errors.length > 0 || rejection !== null;
  const problems = [errors.length > 0 ? `${id}-error` : "", rejection ? `${id}-status` : ""];
  const cropOptions = typeof crop === "object" ? crop : {};

  return (
    <div
      data-ouro="image-field"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={[description != null ? `${id}-description` : "", ...problems].filter(Boolean).join(" ") || undefined}
      data-disabled={disabled ? "" : undefined}
      data-invalid={invalid ? "" : undefined}
      className={cn("grid min-w-0 justify-items-start gap-3", className)}
    >
      <div data-ouro-label="" data-ouro-required={required ? "" : undefined} className={cn("grid gap-1", "data-ouro-required:[&>span:first-child]:after:ms-0.5 data-ouro-required:[&>span:first-child]:after:text-destructive data-ouro-required:[&>span:first-child]:after:content-['*'] supports-[content:'*'_/_'']:data-ouro-required:[&>span:first-child]:after:content-['*'_/_'']", hideLabel && "sr-only")}>
        <span className="text-sm leading-5 font-medium text-foreground">
          <span id={`${id}-label`}>{label}</span>
        </span>
        {description != null ? (
          <span id={`${id}-description`} className="text-sm leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div
        style={{ aspectRatio: aspect }}
        className={cn(
          "flex items-center justify-center overflow-hidden border border-solid bg-muted text-muted-foreground",
          invalid ? "border-destructive" : "border-border",
          shape === "circle" ? "w-32 rounded-full" : "w-full max-w-xs rounded-lg",
        )}
      >
        {file ? (
          <img ref={attach} alt="" className="block size-full object-cover" />
        ) : src ? (
          <img src={src} alt={alt} className="block size-full object-cover" />
        ) : (
          <PhotoIcon />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          data-ouro-control="image-field"
          data-ouro-part="choose"
          variant="outline"
          tone="secondary"
          size="sm"
          disabled={disabled}
          aria-describedby={[`${id}-label`, ...problems].filter(Boolean).join(" ")}
          onClick={() => input.current!.click()}
        >
          {showing ? changeLabel : chooseLabel}
        </Button>
        {file !== null || (src && onRemove) ? (
          <Button data-ouro-control="image-field" data-ouro-part="remove" variant="plain" tone="destructive" size="sm" disabled={disabled} aria-describedby={`${id}-label`} onClick={remove}>
            {removeLabel}
          </Button>
        ) : null}
      </div>
      <input
        ref={setInput}
        data-ouro-control="image-field"
        data-ouro-part="input"
        type="file"
        name={name}
        accept={accept}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        tabIndex={-1}
        hidden
        onChange={choose}
      />
      <div className={cn("grid gap-1 text-sm leading-5 text-destructive", !invalid && "sr-only")}>
        {errors.length > 0 ? (
          <div id={`${id}-error`} className="grid gap-1">
            {errors.map((message, index) => (
              <p key={index} className="m-0">
                {message}
              </p>
            ))}
          </div>
        ) : null}
        {/* Why a file was turned away: a polite status region from the first render, so screen
            readers announce the message once when it appears; hidden while empty. */}
        <p id={`${id}-status`} role="status" className={cn("m-0", !rejection && "sr-only")}>
          {rejection}
        </p>
      </div>
      {crop ? (
        <ImageCropper
          open={pending !== null}
          // The cropper has no trigger, so it only ever asks to close.
          onOpenChange={() => setPending(null)}
          image={pending}
          aspect={aspect}
          shape={shape}
          outputWidth={cropOptions.outputWidth}
          type={cropOptions.type}
          title={cropOptions.title}
          onCrop={take}
          onError={(reason) => {
            if (reason !== "open") return;
            turnAway("unreadable", pending!);
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}
