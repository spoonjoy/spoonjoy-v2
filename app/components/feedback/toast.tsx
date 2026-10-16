import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
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
  const currentId = useRef<string | undefined>(undefined);
  const dismissToast = useCallback(() => {
    if (currentId.current !== undefined) {
      toast.dismiss(currentId.current);
      currentId.current = undefined;
    }
  }, []);
  const showToast = useCallback(({ message, action, durationMs }: ToastPayload) => {
    dismissToast();
    currentId.current = toast(message, { action, duration: durationMs ?? 3000 });
  }, [dismissToast]);
  useEffect(() => dismissToast, [dismissToast]);
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
