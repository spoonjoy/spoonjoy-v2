import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Toaster } from "~/components/ouro/toast/toaster";
import { toast, type ToastAction } from "~/lib/ouro/toast";

type ToastPayload = {
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (payload: ToastPayload) => void;
  dismissToast: () => void;
};

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  dismissToast: () => {},
});

/** Keeps Spoonjoy's single, three-second feedback slot; Ouro owns rendering and announcements. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const committed = useRef(false);
  const currentId = useRef<string | undefined>(undefined);
  const dismissToast = useCallback(() => {
    if (currentId.current !== undefined) {
      toast.dismiss(currentId.current);
      currentId.current = undefined;
    }
  }, []);
  const showToast = useCallback(({ message, action, durationMs }: ToastPayload) => {
    if (!committed.current) return;
    dismissToast();
    currentId.current = toast(message, { action, duration: durationMs ?? 3000 });
  }, [dismissToast]);
  useLayoutEffect(() => {
    // Authorize before child passive effects; revoke before any late async completion.
    // StrictMode's committed replay reauthorizes this same provider, not a disposed one.
    committed.current = true;
    return () => {
      committed.current = false;
      dismissToast();
    };
  }, [dismissToast]);
  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
