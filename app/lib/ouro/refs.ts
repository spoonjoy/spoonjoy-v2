import { useCallback, type Ref, type RefCallback } from "react";

/**
 * Points `ref` at `element` and returns what undoes it. Handles object refs,
 * callback refs, and React 19 callback refs that return their own cleanup.
 *
 * Internal; not exported from the package.
 */
export function attachRef<T>(ref: Ref<T> | undefined, element: T): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(element);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (ref) {
    ref.current = element;
    return () => {
      ref.current = null;
    };
  }
  return () => {};
}

/**
 * One callback ref that sets both an app's `ref` and a component's own ref, so a
 * component can hold an element the app also wants.
 *
 * Internal; not exported from the package.
 *
 * @example
 * const own = useRef<HTMLElement>(null);
 * const ref = useMergedRef(trigger.props.ref, own);
 */
export function useMergedRef<T>(appRef: Ref<T> | undefined, ownRef: Ref<T>): RefCallback<T> {
  return useCallback(
    (element: T) => {
      const detachOwn = attachRef(ownRef, element);
      const detachApp = attachRef(appRef, element);
      return () => {
        detachOwn();
        detachApp();
      };
    },
    [appRef, ownRef],
  );
}
