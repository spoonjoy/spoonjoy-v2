import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogTitle, DialogBody, DialogActions } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { coverScale, clampOffset, getCropPixels, cropImageToBlob, type Size, type Offset } from "~/lib/image-crop";

const VIEWPORT = 256;

interface ProfilePhotoCropperProps {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
  outputSize?: number;
}

export function ProfilePhotoCropper({ file, onConfirm, onCancel, outputSize = 512 }: ProfilePhotoCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });

  // Drag state lives in a ref so the pointer move handler reads the latest
  // values without re-subscribing. A null ref means "not currently dragging".
  const dragRef = useRef<{ startX: number; startY: number; startOffset: Offset } | null>(null);

  // Build (and revoke) the object URL for the selected file. Mirrors the
  // cleanup pattern in RecipeImageUpload.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
  };

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextZoom = Number(e.target.value);
    setZoom(nextZoom);
    if (natural) {
      setOffset((current) => clampOffset(natural, VIEWPORT, nextZoom, current));
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !natural) return;
    const next = {
      x: drag.startOffset.x + (e.clientX - drag.startX),
      y: drag.startOffset.y + (e.clientY - drag.startY),
    };
    setOffset(clampOffset(natural, VIEWPORT, zoom, next));
  };

  const stopDragging = () => {
    dragRef.current = null;
  };

  const handleSave = async () => {
    const image = imgRef.current;
    /* istanbul ignore next -- @preserve Save is disabled until `natural` loads, at which point the img ref is always populated; this guard is purely defensive. */
    if (!natural || !image) return;
    const crop = getCropPixels(natural, VIEWPORT, zoom, offset);
    const blob = await cropImageToBlob(image, crop, outputSize);
    onConfirm(blob);
  };

  const scale = natural ? coverScale(natural, VIEWPORT) * zoom : 1;

  return (
    <Dialog open size="sm" onClose={onCancel}>
      <DialogTitle>Crop your photo</DialogTitle>
      <DialogBody>
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative size-64 touch-none overflow-hidden rounded-full border border-[var(--sj-border)] bg-[var(--sj-flour)] shadow-[var(--sj-shadow-soft)]"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerLeave={stopDragging}
          >
            {!natural && (
              <div
                role="status"
                aria-busy="true"
                className="absolute inset-0 flex items-center justify-center text-[var(--sj-ink-soft)]"
              >
                <Loader2 className="size-8 animate-spin text-[var(--sj-brass)]" />
              </div>
            )}
            {objectUrl && (
              <img
                ref={imgRef}
                src={objectUrl}
                alt="Crop preview"
                onLoad={handleLoad}
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: natural ? `${natural.width * scale}px` : undefined,
                  height: natural ? `${natural.height * scale}px` : undefined,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            )}
          </div>

          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            aria-label="Zoom"
            onChange={handleZoomChange}
            className="w-64 accent-[var(--sj-brass)]"
          />
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!natural}>
          Save photo
        </Button>
      </DialogActions>
    </Dialog>
  );
}
