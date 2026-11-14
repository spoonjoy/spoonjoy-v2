// What Spoonjoy's released Ouro UI controls paint, read from the browser's computed styles under the
// app's compiled stylesheet. Where the engine has corner-shape, a control paints its own fill and
// border; where it does not, Ouro's surface layer paints them, and the layer's ::after draws the
// border. Each expectation is the token the look is bound to, resolved by the engine itself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "~/components/ouro/button/button";
import { NotificationsSection } from "~/components/notifications-section";

vi.mock("~/lib/push-client", () => ({
  isPushSupported: () => ({ supported: true }),
  isIosNonStandalone: () => false,
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

afterEach(cleanup);

type Property = "color" | "background-color" | "border-top-color" | "outline-color";

// A declaration as the engine resolves and normalises it, so both sides of a comparison read alike.
function resolved(value: string, property: Property): string {
  const probe = document.createElement("div");
  probe.style.setProperty(property, value);
  document.body.append(probe);
  const computed = getComputedStyle(probe).getPropertyValue(property);
  probe.remove();
  if (computed === "") throw new Error(`${value} does not resolve as ${property}`);
  return computed;
}

// The surface layer when it paints the control (no corner-shape), else null: then the control paints itself.
function surfaceLayer(control: HTMLElement): HTMLElement | null {
  const layer = control.querySelector<HTMLElement>(":scope > [data-ouro-surface]");
  return layer && getComputedStyle(layer).display !== "none" ? layer : null;
}

function fillOf(control: HTMLElement): string {
  return getComputedStyle(surfaceLayer(control) ?? control).backgroundColor;
}

function borderOf(control: HTMLElement): string {
  const layer = surfaceLayer(control);
  return layer ? getComputedStyle(layer, "::after").backgroundColor : getComputedStyle(control).borderTopColor;
}

describe("Spoonjoy's released Button paints its action tokens", () => {
  it("fills and labels the solid primary button from the action tokens, enabled and disabled", () => {
    render(
      <>
        <Button>Action</Button>
        <Button disabled>Unavailable</Button>
      </>,
    );
    const enabled = screen.getByRole("button", { name: "Action" });
    expect(fillOf(enabled)).toBe(resolved("var(--ouro-action,var(--primary))", "background-color"));
    expect(getComputedStyle(enabled).color).toBe(resolved("var(--ouro-action-foreground,var(--primary-foreground))", "color"));
    expect(getComputedStyle(enabled).fontWeight).toBe("600");
    expect(getComputedStyle(enabled).outlineColor).toBe(resolved("var(--ring)", "outline-color"));
    expect(getComputedStyle(enabled).outlineOffset).toBe("2px");

    const disabled = screen.getByRole("button", { name: "Unavailable" });
    expect(fillOf(disabled)).toBe(resolved("var(--ouro-action-disabled,var(--ouro-action,var(--primary)))", "background-color"));
    expect(getComputedStyle(disabled).color).toBe(
      resolved("var(--ouro-action-disabled-foreground,var(--ouro-action-foreground,var(--primary-foreground)))", "color"),
    );
    expect(getComputedStyle(disabled).opacity).toBe("1");
  });

  it("tints a soft destructive button and outlines a secondary one with the border token", () => {
    render(
      <>
        <Button variant="soft" tone="destructive">Delete</Button>
        <Button variant="outline" tone="secondary">Cancel</Button>
      </>,
    );
    const soft = screen.getByRole("button", { name: "Delete" });
    expect(fillOf(soft)).toBe(resolved("color-mix(in oklab, var(--destructive) 10%, transparent)", "background-color"));

    const outline = screen.getByRole("button", { name: "Cancel" });
    expect(fillOf(outline)).toBe(resolved("transparent", "background-color"));
    expect(getComputedStyle(outline).borderTopWidth).toBe("1px");
    expect(borderOf(outline)).toBe(resolved("var(--border)", "border-top-color"));
  });
});

describe("Spoonjoy's notifications section", () => {
  it("is outlined on all four sides in the border token, not ruled above and below", () => {
    render(
      <>
        <NotificationsSection
          initiallySubscribed={false}
          initialPreferences={{
            notifySpoonOnMyRecipe: true,
            notifyForkOfMyRecipe: true,
            notifyCookbookSaveOfMine: true,
            notifyFellowChefOriginCook: true,
          }}
        />
      </>,
    );
    const section = screen.getByRole("heading", { name: "Notifications", level: 2 }).closest("section")!;
    const style = getComputedStyle(section);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(style.getPropertyValue(`border-${side}-width`)).toBe("1px");
    }
    expect(borderOf(section)).toBe(resolved("var(--border)", "border-top-color"));
  });
});
