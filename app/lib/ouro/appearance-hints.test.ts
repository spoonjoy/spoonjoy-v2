import { describe, expect, it } from "vitest";
import { radiusFor, sizeFor, toneFor } from "~/lib/ouro/appearance-hints";

describe("toneFor", () => {
  it.each([
    ["bg-red-500", "destructive"],
    ["text-rose-600", "destructive"],
    ["bg-emerald-600", "success"],
    ["border-amber-300", "warning"],
    ["text-gray-500", "secondary"],
    ["bg-black", "secondary"],
    ["bg-blue-500", "primary"],
    ["bg-[#123456]", "primary"],
  ])("maps %s to %s", (token, tone) => expect(toneFor(token)).toBe(tone));
});

describe("sizeFor", () => {
  const scale = ["XS", "SM", "BASE", "LG", "XL", "2XL", "BIG"] as const;
  it.each([
    ["text-xs", "XS"],
    ["text-sm", "SM"],
    ["text-base", "BASE"],
    ["text-lg", "LG"],
    ["text-xl", "XL"],
    ["text-2xl", "2XL"],
    ["text-3xl", "BIG"],
    ["text-9xl", "BIG"],
  ])("maps %s to %s", (token, size) => expect(sizeFor(token, scale)).toBe(size));

  it.each(["text-red-500", "text-[13px]", "font-bold"])("ignores %s", (token) =>
    expect(sizeFor(token, scale)).toBeUndefined(),
  );
});

describe("radiusFor", () => {
  it.each([
    ["rounded-none", "0px"],
    ["rounded-full", "999px"],
    ["rounded-lg", "0.75rem"],
    ["rounded", "0.75rem"],
  ])("maps %s to a %s theme radius", (token, value) =>
    expect(radiusFor(token)).toBe(`:root { --radius: ${value} }`),
  );
});
