export const stillMs = 1000;
export const breathMs = 2400;

/**
 * Where a placeholder that mounts at `now` joins the shared wave: a new wave starts after a
 * gap of over `stillMs` with nothing breathing, and the delay puts the placeholder in step
 * with the wave.
 */
export function joinWave(now: number, breathing: number, emptiedAt: number, waveStart: number): { start: number; delay: string } {
  const start = breathing === 0 && now - emptiedAt > stillMs ? now : waveStart;
  const elapsed = now - start;
  return { start, delay: `${-((elapsed - stillMs) % breathMs)}ms` };
}

/**
 * Pegs one placeholder's animation clock to a fresh join, once that animation's own clock has settled on a
 * real frame (its `ready` resolving). Something else can cancel the same animation between `ready` settling
 * and this call running (reduced motion taking over, a node shrinking out of the wave): writing `currentTime`
 * on an animation already idle from that revives it, per the Web Animations spec, undoing the cancel. The
 * narrow `{ playState, currentTime }` shape lets a test drive the race with a plain object in place of a
 * real `CSSAnimation`.
 */
export function correctAnimationClock(animation: { playState: string; currentTime: CSSNumberish | null }, now: number, start: number, staleDelayMs: number): void {
  if (animation.playState === "idle") return;
  const freshDelayMs = Number.parseFloat(joinWave(now, 1, 0, start).delay);
  animation.currentTime = staleDelayMs - freshDelayMs;
}
