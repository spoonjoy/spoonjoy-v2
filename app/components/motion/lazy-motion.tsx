import type { ReactNode } from 'react'
import { LayoutGroup, LazyMotion } from 'motion/react'

// Lists that animate use Motion's `m` components inside this group instead of
// `motion.*`. The `m` components are a few kilobytes and render ordinary elements;
// the animation features (layout, drag, exit) arrive in their own chunk after the page
// has rendered, so they no longer sit in the page's critical JavaScript. `strict` makes
// a stray `motion.*` inside the group an error, because it would pull the full bundle
// back in.
const importMotionFeatures = () => import('./motion-features').then((module) => module.default)

// A chunk that fails to load (a flaky network, or a deploy that replaced it) must not break the
// page: try once more, then leave the features unloaded, a promise that never settles. That is
// the state every page starts in, so the `m` components keep rendering their content; only
// layout, drag and exit animation are missing.
export function loadMotionFeatures(load: typeof importMotionFeatures = importMotionFeatures) {
  return load()
    .catch(() => load())
    .catch(() => new Promise<never>(() => {}))
}

/** A Motion LayoutGroup whose animation features load lazily. */
export function LazyLayoutGroup({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <LazyMotion features={() => loadMotionFeatures()} strict>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </LazyMotion>
  )
}
