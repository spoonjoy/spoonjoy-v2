// The sound, vibration and notification a cook-mode timer makes at zero.
//
// Browsers only let a page play sound after a user gesture, so `prime()` runs when the cook taps
// "Start timer" and keeps the audio context for the alarm that follows. Every capability is
// feature-detected: a browser without Web Audio, vibration or notifications still shows the
// on-screen "Time's up" state.

type AudioContextConstructor = new () => AudioContext;

const BEEP_FREQUENCY_HZ = 880;
const BEEP_SECONDS = 0.18;
const BEEP_GAP_SECONDS = 0.12;
const BEEPS_PER_BURST = 3;
export const VIBRATION_PATTERN = [200, 100, 200, 100, 400];

function audioContextConstructor(): AudioContextConstructor | null {
  const candidate = (globalThis as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor });
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

export interface CookAlarm {
  prime(): void;
  ring(title: string, body: string): void;
  close(): void;
}

export function createCookAlarm(): CookAlarm {
  let context: AudioContext | null = null;

  const ensureContext = (): AudioContext | null => {
    if (context) return context;
    const Constructor = audioContextConstructor();
    if (!Constructor) return null;
    try {
      context = new Constructor();
    } catch {
      context = null;
    }
    return context;
  };

  const beep = (audio: AudioContext) => {
    const start = audio.currentTime;
    for (let index = 0; index < BEEPS_PER_BURST; index += 1) {
      const at = start + index * (BEEP_SECONDS + BEEP_GAP_SECONDS);
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = BEEP_FREQUENCY_HZ;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_SECONDS);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + BEEP_SECONDS);
    }
  };

  return {
    prime() {
      const audio = ensureContext();
      if (audio && audio.state === "suspended") {
        void audio.resume().catch(() => undefined);
      }
    },
    ring(title, body) {
      const audio = ensureContext();
      if (audio) {
        try {
          if (audio.state === "suspended") void audio.resume().catch(() => undefined);
          beep(audio);
        } catch {
          // A failed beep must never break the timer; the screen still says "Time's up".
        }
      }
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(VIBRATION_PATTERN);
        } catch {
          // Vibration is best effort.
        }
      }
      // Only notify when the cook already allowed notifications; never prompt from a timer.
      if (
        typeof window !== "undefined" &&
        typeof window.Notification === "function" &&
        window.Notification.permission === "granted" &&
        document.visibilityState === "hidden"
      ) {
        try {
          new window.Notification(title, { body, tag: "spoonjoy-cook-timer" });
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    },
    close() {
      if (context) {
        void context.close().catch(() => undefined);
        context = null;
      }
    },
  };
}
