export { buzz, chime, createChimeContext };
export type { ChimeOptions };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

type AudioContextConstructor = new () => AudioContext;

/** Options for {@link chime}. */
interface ChimeOptions {
  /**
   * The audio context to play on, from `createChimeContext()` in a click handler. Browsers
   * play sound only after the person has interacted with the page, so create it when they
   * start what will chime later (a timer's Start), and keep it. Without one, `chime` makes
   * its own, which a browser may keep silent.
   */
  context?: AudioContext | null | undefined;
}

const TONE_HZ = 880;
const TONE_SECONDS = 0.18;
const GAP_SECONDS = 0.12;
const TONES = 3;
const PATTERN: readonly number[] = [200, 100, 200, 100, 400];
/**
 * How long a suspended context gets to resume: a browser that keeps the page silent may never settle it.
 *
 * @claim "How long a suspended context gets" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > closes a context it made for itself when the browser never settles resume)
 */
const RESUME_MS = 300;

function constructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Asks a suspended context to resume, giving up after {@link RESUME_MS}; the caller reads its state after. */
async function resumeWithin(audio: AudioContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    audio.resume().catch(() => undefined),
    new Promise<void>((settle) => {
      timer = setTimeout(settle, RESUME_MS);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Makes an audio context for {@link chime}, or returns `null` where the browser has no Web
 * Audio. Call it from a click or key handler, where browsers allow sound to start, and pass
 * it to every later `chime`.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * const context = useRef<AudioContext | null>(null);
 * const start = () => {
 *   context.current ??= createChimeContext();
 *   timer.start();
 * };
 * @claim "Makes an audio context for chime , or returns `null` where the browser has no Web Audio" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::createChimeContext > makes an AudioContext where the browser has Web Audio)
 * @claim "Makes an audio context for chime , or returns `null` where the browser has no Web Audio" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::createChimeContext > returns null without Web Audio, or when the browser refuses one)
 */
function createChimeContext(): AudioContext | null {
  const Context = constructor();
  if (!Context) return null;
  try {
    return new Context();
  } catch {
    return null;
  }
}

/**
 * Plays a short alert, three soft tones, for something that just finished: a timer at zero.
 * It resolves `true` once the tones are scheduled and `false` when the browser has no Web
 * Audio or keeps the page silent (no interaction yet), so the caller can rely on what shows
 * on screen instead. It settles within about 300 ms even when the browser never lets sound
 * start, and a context it made for itself is always closed. It never throws. Pair it with
 * `buzz()` for phones on silent.
 *
 * Use `toast()` instead to tell the person something in words; a chime only draws their
 * attention back to the screen.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * const played = await chime({ context });
 * @claim "It settles within about 300 ms" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > closes a context it made for itself when the browser never settles resume)
 * @claim "It resolves `true` once the tones" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > resolves false soon when the browser never settles resume, and plays nothing when it settles late)
 * @claim "It settles within about 300 ms" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > resolves false soon when the browser never settles resume, and plays nothing when it settles late)
 * @claim "It settles within about 300 ms" registry/ouro/lib/ouro/feedback.ts verify:fileLine(registry/ouro/lib/ouro/feedback.ts, /const\sRESUME_MS\s=\s300;/)
 * @claim "Plays a short alert, three soft" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > schedules three short tones on the context it is given, and leaves it open)
 * @claim "Plays a short alert, three soft" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::buzz > vibrates in a short alert pattern where the device can)
 * @claim "It never throws" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::chime > resolves false, without throwing, when Web Audio fails)
 */
async function chime({ context }: ChimeOptions = {}): Promise<boolean> {
  const audio = context ?? createChimeContext();
  if (!audio) return false;
  // A context chime made for itself is closed once its tones end, or at once when it stays silent.
  const own = !context;
  const done = () => {
    if (own) void audio.close().catch(() => undefined);
  };
  try {
    if (audio.state === "suspended") await resumeWithin(audio);
    // Still not running after the wait: stay silent now rather than play late.
    if (audio.state !== "running") {
      done();
      return false;
    }
    const start = audio.currentTime;
    for (let index = 0; index < TONES; index += 1) {
      const at = start + index * (TONE_SECONDS + GAP_SECONDS);
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = TONE_HZ;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + TONE_SECONDS);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + TONE_SECONDS);
      if (index === TONES - 1) oscillator.onended = done;
    }
    return true;
  } catch {
    done();
    return false;
  }
}

/**
 * Vibrates the device in a short alert pattern, where it can (most Android phones; not iOS
 * or desktops). Returns whether it did. Call it with `chime()`, so a phone on silent still
 * gets the alert.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/timer
 *
 * @example
 * buzz();
 * @claim "Vibrates the device in a short" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::buzz > vibrates in a short alert pattern where the device can)
 * @claim "Vibrates the device in a short" registry/ouro/lib/ouro/feedback.test.ts verify:testExists(registry/ouro/lib/ouro/feedback.test.ts::buzz > returns false where the device cannot vibrate or refuses)
 * @claim "Vibrates the device in a short" https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate verify:urlOk(https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
 */
function buzz(): boolean {
  /* istanbul ignore if @preserve -- server only */
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate([...PATTERN]);
  } catch {
    return false;
  }
}
