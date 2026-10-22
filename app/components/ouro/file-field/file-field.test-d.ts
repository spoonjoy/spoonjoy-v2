import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { FileField, type FileFieldProps, type FileRejection } from "~/components/ouro/file-field/file-field";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<FileFieldProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

expectTypeOf<{ label: "Photo" }>().toExtend<FileFieldProps>();
expectTypeOf<{
  label: "Photos";
  hideLabel: true;
  description: "Up to 5 MB each.";
  error: "Add a photo.";
  required: true;
  disabled: true;
  name: "photos";
  accept: "image/*,.heic";
  multiple: true;
  maxSize: 5242880;
  onFilesChange: (files: File[]) => void;
  onReject: (rejections: FileRejection[]) => void;
  rejectMessage: (rejection: FileRejection) => string;
  capture: "environment";
  prompt: "Drop photos";
  removeLabel: "Remove";
  className: "mt-4";
}>().toExtend<FileFieldProps>();
// rejectMessage returns the message text.
expectTypeOf<{ label: "Photo"; rejectMessage: (rejection: FileRejection) => number }>().not.toExtend<FileFieldProps>();
expectTypeOf<FileRejection["reason"]>().toEqualTypeOf<"type" | "size" | "count">();

// The label is required.
expectTypeOf<{ accept: "image/*" }>().not.toExtend<FileFieldProps>();
// maxSize is a number of bytes, not text.
expectTypeOf<{ label: "Photo"; maxSize: "5MB" }>().not.toExtend<FileFieldProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Photo"; maxFileSize: 100 }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; acceptedFileTypes: string[] }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; onChange: () => void }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; onDrop: () => void }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; errorMessage: "x" }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; helperText: "x" }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; isInvalid: true }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; invalid: true }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; isRequired: true }>().not.toExtend<FileFieldProps>();
expectTypeOf<{ label: "Photo"; isDisabled: true }>().not.toExtend<FileFieldProps>();

// @ts-expect-error label is required.
createElement(FileField, { accept: "image/*" });
// @ts-expect-error maxFileSize is maxSize.
createElement(FileField, { label: "Photo", maxFileSize: 100 });
