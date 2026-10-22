import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ImageCropper, type ImageCropperFailure, type ImageCropperProps } from "~/components/ouro/image-cropper/image-cropper";

// Type tests: `pnpm typecheck` compiles this file.

type Required = { open: true; onOpenChange: (open: boolean) => void; image: null; onCrop: (file: File) => void };
expectTypeOf<Required>().toExtend<ImageCropperProps>();
expectTypeOf<Required & { title: "Crop"; aspect: 1.5; shape: "circle"; outputWidth: 512; type: "image/png"; labels: { save: "Use" } }>().toExtend<ImageCropperProps>();
expectTypeOf<ComponentProps<typeof ImageCropper>>().toEqualTypeOf<ImageCropperProps>();
expectTypeOf<Required & { onError: (reason: ImageCropperFailure) => void; labels: { openError: "Kaputt"; saveError: "Nicht gespeichert" } }>().toExtend<ImageCropperProps>();
expectTypeOf<ImageCropperFailure>().toEqualTypeOf<"open" | "save">();

// open, onOpenChange, image and onCrop are required.
expectTypeOf<Omit<Required, "onCrop">>().not.toExtend<ImageCropperProps>();
expectTypeOf<Omit<Required, "image">>().not.toExtend<ImageCropperProps>();

// Guessed props and values name the fix.
expectTypeOf<Required & { src: "/a.png" }>().not.toExtend<ImageCropperProps>();
expectTypeOf<Required & { aspectRatio: 1 }>().not.toExtend<ImageCropperProps>();
expectTypeOf<Required & { shape: "oval" }>().not.toExtend<ImageCropperProps>();
expectTypeOf<Required & { onChange: () => void }>().not.toExtend<ImageCropperProps>();

// @ts-expect-error src is not a prop.
createElement(ImageCropper, { open: true, onOpenChange: () => {}, image: null, onCrop: () => {}, src: "/a.png" });
