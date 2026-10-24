import { useEffect, useRef } from "react";

/** How far down the page a reader may already be before the page stops bringing the step into view. */
const UNTOUCHED_SCROLL_PX = 48;

/**
 * Brings the cook's current step into view once their progress has loaded, so coming back to a
 * recipe lands where they left off. It moves the page once per step it is given and never when the
 * reader has already scrolled, followed a `#` link, or is in cook mode.
 */
export function useResumeStepScroll(stepNum: number | null, cookMode: boolean) {
  const scrolledTo = useRef<number | null>(null);

  useEffect(() => {
    if (stepNum === null || cookMode || scrolledTo.current === stepNum) return;
    scrolledTo.current = stepNum;
    if (window.location.hash !== "" || window.scrollY > UNTOUCHED_SCROLL_PX) return;
    const target = document.getElementById(`step-${stepNum}`);
    target?.scrollIntoView?.({ block: "start" });
  }, [stepNum, cookMode]);
}
