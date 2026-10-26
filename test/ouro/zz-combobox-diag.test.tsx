import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Combobox } from "~/components/ouro/combobox/combobox";
import { act } from "~/lib/ouro/testing/act";
import { audit, axeExclude, describeFindings } from "~/lib/ouro/testing/axe";
import { OuroProvider } from "~/lib/ouro/ouro-provider";

const herbs = ["Basil", "Chives", "Dill", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Thyme"];
const describe = (el: Element | null) => {
  if (!el) return "null";
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}[${[...el.attributes].map((a) => `${a.name}=${a.value.slice(0, 60)}`).join(" ")}] rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} pos=${s.position} z=${s.zIndex} bg=${s.backgroundColor} op=${s.opacity}`;
};

it("DIAG combobox overlap", async () => {
  const main = document.createElement("main");
  main.innerHTML = '<h1>Recipes</h1><a href="#notes">Notes</a><span aria-hidden="true" data-ornament="">~</span>';
  document.body.append(main);
  const host = document.createElement("div");
  main.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <OuroProvider portalContainer={main}>
        <div className="grid gap-4">
          <Combobox label="Herb" name="herb" items={herbs} />
          <Combobox label="Garnish" name="garnish" items={herbs} />
        </div>
      </OuroProvider>,
    ),
  );
  await userEvent.click(host.querySelector<HTMLInputElement>('input[role="combobox"]')!);
  await expect.poll(() => document.querySelector('[data-ouro="combobox-popup"]')).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const link = main.querySelector("a")!;
  const r = link.getBoundingClientRect();
  const lines: string[] = [];
  lines.push(`viewport ${innerWidth}x${innerHeight} scroll ${scrollX},${scrollY}`);
  lines.push(`link ${describe(link)}`);
  for (const [x, y] of [[r.left + 1, r.top + 1], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 1, r.bottom - 1]]) {
    lines.push(`at ${Math.round(x)},${Math.round(y)}: ` + document.elementsFromPoint(x, y).slice(0, 6).map(describe).join("\n    > "));
  }
  for (const el of main.children) lines.push(`main child ${describe(el)}`);
  for (const el of document.body.children) lines.push(`body child ${describe(el)}`);
  const results = await audit({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) });
  lines.push(`findings: ${describeFindings(results)}`);
  lines.push(`raw: ${JSON.stringify(results).slice(0, 4000)}`);
  console.log(`DIAG-BEGIN\n${lines.join("\n")}\nDIAG-END`);
  await act(async () => root.unmount());
  main.remove();
});
