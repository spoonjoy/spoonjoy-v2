import { afterEach, describe, expect, it } from "vitest";
import { honesty } from "./honesty";

// The honesty check must pass a flat squircle with a flat ring, and find each fault when one is added (its canary).

let host: HTMLElement | undefined;
afterEach(() => host?.remove());

function flat(): HTMLElement {
  host = document.createElement("div");
  host.innerHTML = `<button style="border-radius: 12px; corner-shape: squircle; background: #fff; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000"><span style="border-radius: 2px; corner-shape: squircle; background: #06c">Pearl</span></button>`;
  document.body.append(host);
  return host.querySelector("button")!;
}

describe("honesty", () => {
  it.runIf(CSS.supports("corner-shape", "squircle"))("passes a flat squircle with a flat ring", () => {
    const button = flat();
    const result = honesty([button, ...button.querySelectorAll("*")]);
    expect(result).toEqual({ elements: 2, rounded: 8, problems: [] });
  });

  it.runIf(CSS.supports("corner-shape", "squircle"))("finds a gradient, a round corner and a blurred shadow when one is added", () => {
    const button = flat();
    button.style.backgroundImage = "linear-gradient(red, blue)";
    button.style.setProperty("corner-shape", "round");
    button.style.boxShadow = "0 4px 12px black";
    const problems = honesty([button]).problems;
    expect(problems.filter((line) => line.includes("gradient"))).toHaveLength(1);
    expect(problems.filter((line) => line.includes("not a squircle"))).toHaveLength(4);
    expect(problems.filter((line) => line.includes("blurred box-shadow"))).toHaveLength(1);
  });

  it("calls a corner unsupported where the engine has no corner-shape, and ignores a square one", () => {
    host = document.createElement("div");
    host.innerHTML = `<span style="border-radius: 8px"></span><span></span>`;
    document.body.append(host);
    const result = honesty(host.querySelectorAll("span"));
    expect(result.rounded).toBe(4);
    expect(result.problems).toHaveLength(4);
  });
});
