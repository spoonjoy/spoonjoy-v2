import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastPayload = {
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type ToastState = {
  id: number;
  message: string;
  action?: ToastAction;
};

type ToastContextValue = {
  showToast: (payload: ToastPayload) => void;
  dismissToast: () => void;
};

const defaultContextValue: ToastContextValue = {
  showToast: () => {},
  dismissToast: () => {},
};

const ToastContext = createContext<ToastContextValue>(defaultContextValue);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const showToast = useCallback(({ message, action, durationMs }: ToastPayload) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setToast({
      id: Date.now(),
      message,
      action,
    });

    timeoutRef.current = window.setTimeout(() => {
      setToast(null);
      timeoutRef.current = null;
    }, durationMs ?? 3000);
  }, []);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const contextValue = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {mounted && toast
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
              style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
            >
              <div
                className={clsx(
                  "pointer-events-auto w-full max-w-xl rounded-full border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] px-4 py-2.5 shadow-[var(--sj-shadow-soft)]",
                  "font-sj-ui text-sm font-semibold tracking-[0.01em] text-[var(--sj-ink)]"
                )}
                role="status"
                aria-live="polite"
                data-testid="toast-snackbar"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{toast.message}</span>
                  {toast.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        toast.action?.onClick();
                        dismissToast();
                      }}
                      className="rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-[var(--sj-tomato)] hover:text-[var(--sj-brass)]"
                    >
                      {toast.action.label}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
