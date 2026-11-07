export { animationsSettled, censusExclusions, collectInPage, interactiveSelector };
export type { InPageControl };

/** Every element a person can focus or operate: native controls, links, editable regions, anything in the tab order, and the ARIA widget roles. */
declare const interactiveSelector: string;
/** The `interactiveSelector` matches that are no control: Base UI's focus guards. */
declare const censusExclusions: readonly string[];

/** One control as the page reports it. */
interface InPageControl {
  visible: boolean;
  role: string;
  name: string;
  control: string | null;
  part: string | null;
  landmark: { role: string; name: string } | null;
  testId: string | null;
}

/** Every `selector` match except the `exclusions`, with its role, name, marker and context. Needs axe-core on `window.axe`. */
declare function collectInPage(options: { selector: string; exclusions: readonly string[] }): InPageControl[];
/** Whether no finite animation is running. */
declare function animationsSettled(): boolean;
