"use client";

import { useCallback, useId, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Slider } from "~/components/ouro/slider/slider";
import {
  clampOffset,
  coverScale,
  cropRect,
  MAX_ZOOM,
  MIN_ZOOM,
  STEP,
  type Offset,
  type Size,
} from "~/components/ouro/image-cropper/image-cropper-styles";

/** The words the cropper shows and says, for apps in other languages. */
export interface ImageCropperLabels {
  /** @default "Save" */
  save?: string | undefined;
  /** @default "Cancel" */
  cancel?: string | undefined;
  /** The zoom slider's label. @default "Zoom" */
  zoom?: string | undefined;
  /** The crop area's name for screen readers. @default "Photo to crop" */
  area?: string | undefined;
  /** How to move the photo, read with the crop area. @default "Drag the photo, or move it with the arrow keys, to choose what shows. Plus and minus zoom." */
  instructions?: string | undefined;
  /** Shown and announced when the browser cannot open the image. @default "This photo could not be opened. Choose another one." */
  openError?: string | undefined;
  /** Shown and announced when the browser cannot save the crop; Save can be tried again. @default "The photo could not be saved. Try again." */
  saveError?: string | undefined;
}

/** What went wrong: `open`, the browser cannot show the image (a format it cannot decode, or an address it may not read); `save`, it cannot encode the crop. */
export type ImageCropperFailure = "open" | "save";

/** Props for {@link ImageCropper}. */
export interface ImageCropperProps {
  /** Whether the cropper's dialog is open. */
  open: boolean;
  /** Called when it opens or closes: after Save, Cancel, Escape or the close button. */
  onOpenChange: (open: boolean) => void;
  /** The image to crop: a `File` from a picker, a `Blob`, or a URL the page may read pixels from (same origin or CORS). */
  image: File | Blob | string | null;
  /** Called with the cropped image, as a `File`, when the person saves. The dialog then closes. */
  onCrop: (file: File) => void;
  /** The dialog's title. @default "Crop photo" */
  title?: string | undefined;
  /** The crop's width divided by its height: `1` square, `16 / 9` wide. @default 1 */
  aspect?: number | undefined;
  /** `circle` shows a round frame for a profile photo; the saved image is still the square around it. @default "rect" */
  shape?: "rect" | "circle" | (string & { 'Use "rect" or "circle"': never }) | undefined;
  /** The saved image's width in pixels; its height follows `aspect`. @default 1024 */
  outputWidth?: number | undefined;
  /** The saved image's format. @default "image/jpeg" */
  type?: "image/jpeg" | "image/png" | "image/webp" | (string & { 'Use "image/jpeg", "image/png" or "image/webp"': never }) | undefined;
  /** The words it shows and says. */
  labels?: ImageCropperLabels | undefined;
  /** Called when the image cannot be opened or the crop cannot be saved. The cropper shows and announces `labels.openError` or `labels.saveError` itself; close it or offer another image. */
  onError?: ((reason: ImageCropperFailure) => void) | undefined;

  /** Not a prop. The cropped image comes to `onCrop`: `<ImageCropper onCrop={(file) => …} />`. */
  onChange?: { 'Use onCrop={(file) => ...}': never };
  /** Not a prop. The image is `image`: `<ImageCropper image={file} />`. */
  src?: { 'Use image={file}': never };
  /** Not a prop. The shape is `aspect`, width over height: `aspect={16 / 9}`. */
  aspectRatio?: { 'Use aspect={16 / 9}': never };
  /** Not a prop. Ouro UI uses `shape`: `<ImageCropper shape="circle" />`. */
  round?: { 'Use shape="circle"': never };
}

const FRAME_WIDTH = 288;
const words = {
  save: "Save",
  cancel: "Cancel",
  zoom: "Zoom",
  area: "Photo to crop",
  instructions: "Drag the photo, or move it with the arrow keys, to choose what shows. Plus and minus zoom.",
  openError: "This photo could not be opened. Choose another one.",
  saveError: "The photo could not be saved. Try again.",
};

/** Draws the chosen part of the image at the output size and returns it as a file. */
async function crop(image: HTMLImageElement, natural: Size, frame: Size, scale: number, offset: Offset, width: number, type: string, name: string): Promise<File> {
  const rect = cropRect(natural, frame, scale, offset);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round((width * frame.height) / frame.width);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("The browser could not encode the image."))), type, 0.92));
  const extension = blob.type.split("/")[1]!.replace("jpeg", "jpg");
  return new File([blob], `${name.replace(/\.[^.]+$/, "")}.${extension}`, { type: blob.type });
}

/**
 * A dialog for cropping a photo to a shape before it is used: drag the photo (or move it the
 * way the arrow keys point) to choose what shows in the frame, zoom with the slider (or Plus and Minus),
 * and Save hands the cropped image to `onCrop` as a `File`, ready for a form or an upload.
 * The frame is a rectangle of `aspect`, or a circle for a profile photo. It always opens as a
 * centered dialog, so dragging the photo never drags the dialog away.
 *
 * Use `ImageField` with `crop` instead to pick a photo and crop it in one field, and `FileField`
 * for files that need no cropping.
 *
 * @group Forms
 * @see https://ui.ouro.bot/docs/image-cropper
 *
 * @example
 * <ImageCropper open={file !== null} onOpenChange={(open) => !open && setFile(null)} image={file} shape="circle" onCrop={upload} />
 * @claim "It always opens as a centered" registry/ouro/components/ouro/image-cropper/image-cropper.tsx verify:fileLine(registry/ouro/components/ouro/image-cropper/image-cropper.tsx, /presentation="dialog"/)
 */
export function ImageCropper(props: ImageCropperProps): JSX.Element {
  const {
    open,
    onOpenChange,
    image,
    onCrop,
    title = "Crop photo",
    aspect: aspectProp = 1,
    shape: shapeProp = "rect",
    outputWidth = 1024,
    type: typeProp = "image/jpeg",
    labels,
    onError,
    // Guard props (hint types), never used.
    onChange,
    src: srcProp,
    aspectRatio,
    round,
  } = props;
  const aspect = aspectProp > 0 && Number.isFinite(aspectProp) ? aspectProp : 1;
  const shape = shapeProp === "circle" ? "circle" : "rect";
  const type = ["image/jpeg", "image/png", "image/webp"].includes(typeProp) ? typeProp : "image/jpeg";
  useDevWarnings(
    "ImageCropper",
    process.env.NODE_ENV !== "production"
      ? () => [
          aspect !== aspectProp && [`aspect={${String(aspectProp)}} is not a ratio; it is the width over the height, above 0`, "<ImageCropper aspect={16 / 9} />"],
          shape !== shapeProp && [`shape="${String(shapeProp)}" is not a shape; use "rect" or "circle"`, '<ImageCropper shape="circle" />'],
          type !== typeProp && [`type="${String(typeProp)}" is not an image format the browser saves`, '<ImageCropper type="image/jpeg" />'],
          onChange !== undefined && ["onChange is not a prop", "<ImageCropper onCrop={(file) => {}} />"],
          srcProp !== undefined && ["src is not a prop", "<ImageCropper image={file} />"],
          aspectRatio !== undefined && ["aspectRatio is not a prop", "<ImageCropper aspect={16 / 9} />"],
          round !== undefined && ["round is not a prop", '<ImageCropper shape="circle" />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const word = { ...words, ...Object.fromEntries(Object.entries(labels ?? {}).filter(([, value]) => value !== undefined)) };
  const frame: Size = { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH / aspect) };

  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ImageCropperFailure | null>(null);
  const statusId = useId();
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);
  // A File or Blob is shown through an object URL that lives as long as its <img>.
  const attach = useCallback(
    (element: HTMLImageElement | null) => {
      /* istanbul ignore if @preserve -- React 19 calls a ref that returns a cleanup with the element only */
      if (!element) return;
      img.current = element;
      if (typeof image === "string") {
        element.src = image;
        return;
      }
      const url = URL.createObjectURL(image!);
      element.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [image],
  );
  // A new image starts centred at the smallest zoom.
  const [shown, setShown] = useState(image);
  if (shown !== image) {
    setShown(image);
    setNatural(null);
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setFailure(null);
  }

  const scale = natural ? coverScale(natural, frame) * zoom : 1;
  const move = (next: Offset, nextZoom = zoom) => {
    if (!natural) return;
    setOffset(clampOffset(natural, frame, coverScale(natural, frame) * nextZoom, next));
  };
  const zoomTo = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    move(offset, clamped);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    move({ x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP * 10 : STEP;
    const moves: Record<string, Offset> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const by = moves[event.key];
    if (by) move({ x: offset.x + by.x, y: offset.y + by.y });
    else if (event.key === "+" || event.key === "=") zoomTo(zoom + 0.1);
    else if (event.key === "-" || event.key === "_") zoomTo(zoom - 0.1);
    else return;
    event.preventDefault();
  };

  const fail = (reason: ImageCropperFailure) => {
    setFailure(reason);
    onError?.(reason);
  };
  const save = async () => {
    setSaving(true);
    setFailure(null);
    let file: File;
    try {
      file = await crop(img.current!, natural!, frame, scale, offset, outputWidth, type, image instanceof File ? image.name : "photo");
    } catch {
      // The browser could not encode the image; the dialog stays open, so Save can be tried again.
      setSaving(false);
      fail("save");
      return;
    }
    setSaving(false);
    // Outside the try, so an error the app's onCrop throws reaches the app.
    onCrop(file);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      presentation="dialog"
      size="sm"
      footer={
        <>
          <Button data-ouro-control="image-cropper" data-ouro-part="cancel" variant="outline" tone="secondary" onClick={() => onOpenChange(false)}>
            {word.cancel}
          </Button>
          <Button data-ouro-control="image-cropper" data-ouro-part="save" onClick={save} disabled={!natural} loading={saving}>
            {word.save}
          </Button>
        </>
      }
    >
      <div data-ouro="image-cropper" data-shape={shape} className="grid justify-items-center gap-4">
        <div
          data-ouro-control="image-cropper"
          data-ouro-part="area"
          role="application"
          aria-label={word.area}
          aria-describedby={failure ? `ouro-image-cropper-instructions ${statusId}` : "ouro-image-cropper-instructions"}
          aria-busy={natural || failure === "open" ? undefined : true}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          style={{ width: frame.width, height: frame.height }}
          className={cn(
            "relative max-w-full cursor-grab touch-none overflow-hidden bg-muted select-none active:cursor-grabbing",
            "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid",
            shape === "circle" ? "rounded-full" : "rounded-lg",
          )}
        >
          {/* `left`, not `start`: the offset and the crop are in screen pixels in either direction. */}
          {image !== null ? (
            <img
              ref={attach}
              alt=""
              draggable={false}
              crossOrigin={typeof image === "string" ? "anonymous" : undefined}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => fail("open")}
              className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: natural ? natural.width * scale : undefined,
                height: natural ? natural.height * scale : undefined,
                translate: `calc(-50% + ${offset.x}px) calc(-50% + ${offset.y}px)`,
                visibility: natural ? undefined : "hidden",
              }}
            />
          ) : null}
        </div>
        <p id="ouro-image-cropper-instructions" className="sr-only">
          {word.instructions}
        </p>
        {/* A polite status region from the first render, so a failure is announced once when it appears; hidden while empty. */}
        <p id={statusId} role="status" className={cn("m-0 text-center text-sm leading-5 text-destructive", !failure && "sr-only")}>
          {failure === "open" ? word.openError : failure === "save" ? word.saveError : null}
        </p>
        <Slider label={word.zoom} min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom} onValueChange={zoomTo} disabled={!natural} format={{ style: "percent" }} className="w-full max-w-72" />
      </div>
    </Dialog>
  );
}
