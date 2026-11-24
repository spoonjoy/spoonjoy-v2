import type { AtRule, Root } from "postcss";

export function hasShapeVarSegment(value: string): boolean;
export function shapeVarFallback(): {
  postcssPlugin: string;
  OnceExit(root: Root, helpers: { AtRule: typeof AtRule }): void;
};
