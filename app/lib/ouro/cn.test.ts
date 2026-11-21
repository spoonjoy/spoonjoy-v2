import { expect, it } from "vitest";
import { cn } from "~/lib/ouro/cn";

it("joins classes and skips falsy values", () => {
  expect(cn("m-0", false, undefined, "flex", null, "")).toBe("m-0 flex");
});

it("lets a later class win over an earlier one that sets the same property", () => {
  expect(cn("h-11 px-4", "h-20")).toBe("px-4 h-20");
  expect(cn("max-w-[32rem]", "max-w-lg")).toBe("max-w-lg");
});

it("keeps classes that set different properties, or the same property under another variant", () => {
  expect(cn("m-0", "mt-4")).toBe("m-0 mt-4");
  expect(cn("h-11 sm:h-9", "h-20")).toBe("sm:h-9 h-20");
  // So Button sets its density through variables, with one unprefixed h-* and px-*.
  expect(cn("h-(--ouro-button-h) px-(--ouro-button-px) sm:[--ouro-button-h:2rem]", "h-20 px-8")).toBe(
    "sm:[--ouro-button-h:2rem] h-20 px-8",
  );
  expect(cn("text-base text-primary", "text-sm")).toBe("text-primary text-sm");
});

it("resolves Ouro's radius steps as rounded-* classes, so a later radius or rounded-none wins", () => {
  expect(cn("rounded-ouro-lg", "rounded-none")).toBe("rounded-none");
  expect(cn("rounded-none", "rounded-ouro-lg")).toBe("rounded-ouro-lg");
  expect(cn("rounded-ouro-lg", "rounded-lg")).toBe("rounded-lg");
});

it("keeps a side's radius beside a corner radius, and a later whole radius replaces it", () => {
  expect(cn("rounded-t-ouro-lg", "rounded-ouro-md")).toBe("rounded-ouro-md");
  expect(cn("rounded-ouro-md", "rounded-t-ouro-lg")).toBe("rounded-ouro-md rounded-t-ouro-lg");
});

it("lets an app's width or height class win over a fixed-size step, as it does over a spacing class", () => {
  expect(cn("w-ouro-17 h-ouro-144", "w-20 h-80")).toBe("w-20 h-80");
  expect(cn("size-ouro-6", "size-10")).toBe("size-10");
  expect(cn("-ms-ouro-2", "ms-4")).toBe("ms-4");
  expect(cn("h-ouro-11", "pointer-fine:h-9")).toBe("h-ouro-11 pointer-fine:h-9");
});

it("resolves every one of Ouro's radius steps, sm to 4xl, as a rounded-* class", () => {
  for (const step of ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
    expect(cn(`rounded-ouro-${step}`, "rounded-none")).toBe("rounded-none");
    expect(cn(`rounded-t-ouro-${step}`, "rounded-ouro-lg")).toBe("rounded-ouro-lg");
  }
});
