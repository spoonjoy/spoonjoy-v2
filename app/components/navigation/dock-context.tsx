import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Lets a page hide the phone tab bar while it shows something full screen, such as cook mode
 * or an inline title editor. The tab bar itself is navigation only and never takes page
 * actions; those live on the page.
 */
export interface DockContextValue {
  setSuppressed: (suppressed: boolean) => void;
  isSuppressed: boolean;
}

const defaultValue: DockContextValue = {
  setSuppressed: () => {},
  isSuppressed: false,
};

export const DockContext = createContext<DockContextValue>(defaultValue);

export interface DockContextProviderProps {
  children: ReactNode;
}

export function DockContextProvider({ children }: DockContextProviderProps) {
  const [isSuppressed, setSuppressed] = useState(false);
  const value = useMemo<DockContextValue>(() => ({ setSuppressed, isSuppressed }), [isSuppressed]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDockContext(): DockContextValue {
  return useContext(DockContext);
}

export function useDockSuppressed(suppressed: boolean): void {
  const { setSuppressed } = useDockContext();

  useEffect(() => {
    setSuppressed(suppressed);
  }, [suppressed, setSuppressed]);

  useEffect(() => {
    return () => {
      setSuppressed(false);
    };
  }, [setSuppressed]);
}
