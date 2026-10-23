import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ImageField, type ImageFieldProps, type ImageFieldRejection } from "~/components/ouro/image-field/image-field";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ label: "Photo" }>().toExtend<ImageFieldProps>();
expectTypeOf<{ label: "Photo"; name: "photo"; src: null; shape: "circle"; aspect: 1; crop: { outputWidth: 512 }; maxSize: 1024; onFileChange: (file: File | null) => void; onRemove: () => void; className: "mt-6" }>().toExtend<ImageFieldProps>();
expectTypeOf<{ label: "Photo"; crop: true }>().toExtend<ImageFieldProps>();
expectTypeOf<ComponentProps<typeof ImageField>>().toEqualTypeOf<ImageFieldProps>();
expectTypeOf<ImageFieldRejection>().toEqualTypeOf<"type" | "size" | "unreadable">();

// label is required.
expectTypeOf<{ name: "photo" }>().not.toExtend<ImageFieldProps>();

// Guessed props and values name the fix.
expectTypeOf<{ label: "P"; value: "x" }>().not.toExtend<ImageFieldProps>();
expectTypeOf<{ label: "P"; onChange: () => void }>().not.toExtend<ImageFieldProps>();
expectTypeOf<{ label: "P"; maxFileSize: 1 }>().not.toExtend<ImageFieldProps>();
expectTypeOf<{ label: "P"; cropper: true }>().not.toExtend<ImageFieldProps>();
expectTypeOf<{ label: "P"; shape: "square" }>().not.toExtend<ImageFieldProps>();

// The frame's words while a file is dragged over it.
expectTypeOf<{ label: "Foto"; dropLabel: "Suelta la foto aquí" }>().toExtend<ImageFieldProps>();

// @ts-expect-error value is not a prop.
createElement(ImageField, { label: "P", value: "x" });
