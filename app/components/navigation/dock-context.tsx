import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";

export type DockActionHandler = (() => void) | string;

export interface DockButton {
  id: string;
  icon: ElementType;
  label: string;
  sublabel?: string;
  ariaLabel?: string;
  onAction: DockActionHandler;
  active?: boolean;
  tone?: "default" | "primary" | "danger" | "quiet";
  iconClassName?: string;
  labelClassName?: string;
}

export interface DockConfig {
  left: DockButton;
  primary: DockButton;
  tools: DockButton[];
  ariaLabel?: string;
  variant?: "root" | "context" | "task";
}

/**
 * Legacy action shape kept for small callers/tests that still register a pair
 * of side actions. New route code should prefer DockConfig.
 */
export interface DockAction extends DockButton {
  position: "left" | "right";
}

export interface DockContextValue {
  config: DockConfig | null;
  actions: DockAction[] | null;
  setConfig: (config: DockConfig | null) => void;
  setActions: (actions: DockAction[] | null) => void;
  setSuppressed: (suppressed: boolean) => void;
  isContextual: boolean;
  isSuppressed: boolean;
}

const defaultValue: DockContextValue = {
  config: null,
  actions: null,
  setConfig: () => {},
  setActions: () => {},
  setSuppressed: () => {},
  isContextual: false,
  isSuppressed: false,
};

export const DockContext = createContext<DockContextValue>(defaultValue);

export interface DockContextProviderProps {
  children: ReactNode;
}

export function configFromActions(actions: DockAction[] | null): DockConfig | null {
  if (!actions || actions.length === 0) return null;

  const left = actions.find((action) => action.position === "left") ?? actions[0];
  const rightActions = actions.filter((action) => action.position === "right");
  const primary = rightActions[0] ?? actions[1] ?? left;
  const tools = rightActions.slice(1, 3);

  return {
    left: { ...left, sublabel: left.sublabel ?? "back" },
    primary,
    tools,
    variant: "context",
  };
}

function actionsFromConfig(config: DockConfig | null): DockAction[] | null {
  if (!config) return null;
  return [
    { ...config.left, position: "left" },
    { ...config.primary, position: "right" },
    ...config.tools.map((tool) => ({ ...tool, position: "right" as const })),
  ];
}

export function DockContextProvider({ children }: DockContextProviderProps) {
  const [config, setConfigState] = useState<DockConfig | null>(null);
  const [actions, setActionsState] = useState<DockAction[] | null>(null);
  const [isSuppressed, setSuppressed] = useState(false);

  const setConfig = useCallback((newConfig: DockConfig | null) => {
    setActionsState(actionsFromConfig(newConfig));
    setConfigState(newConfig);
  }, []);

  const setActions = useCallback((newActions: DockAction[] | null) => {
    setActionsState(newActions);
    setConfigState(configFromActions(newActions));
  }, []);

  const isContextual = config !== null;

  const value = useMemo<DockContextValue>(
    () => ({
      config,
      actions,
      setConfig,
      setActions,
      setSuppressed,
      isContextual,
      isSuppressed,
    }),
    [config, actions, setConfig, setActions, isContextual, isSuppressed],
  );

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDockContext(): DockContextValue {
  return useContext(DockContext);
}

export function useDockConfig(config: DockConfig | null): void {
  const { setConfig } = useDockContext();
  const latestConfigRef = useRef<DockConfig | null>(null);
  const liveHandlersRef = useRef(new Map<string, () => void>());
  const configKey = JSON.stringify(config
    ? {
        ariaLabel: config.ariaLabel ?? null,
        variant: config.variant ?? null,
        buttons: [config.left, config.primary, ...config.tools].map((button) => ({
          id: button.id,
          label: button.label,
          sublabel: button.sublabel ?? null,
          ariaLabel: button.ariaLabel ?? null,
          active: button.active ?? false,
          tone: button.tone ?? null,
          iconClassName: button.iconClassName ?? null,
          labelClassName: button.labelClassName ?? null,
          href: typeof button.onAction === "string" ? button.onAction : null,
        })),
      }
    : null);

  useLayoutEffect(() => {
    latestConfigRef.current = config;
    liveHandlersRef.current = new Map(
      config
        ? [config.left, config.primary, ...config.tools].flatMap((button) => (
            typeof button.onAction === "function"
              ? [[button.id, button.onAction] as const]
              : []
          ))
        : [],
    );
  }, [config]);

  useEffect(() => {
    const latestConfig = latestConfigRef.current;
    if (!latestConfig) {
      setConfig(null);
      return;
    }

    const bindLiveHandler = (button: DockButton): DockButton => (
      typeof button.onAction === "function"
        ? {
            ...button,
            onAction: () => liveHandlersRef.current.get(button.id)?.(),
          }
        : button
    );
    setConfig({
      ...latestConfig,
      left: bindLiveHandler(latestConfig.left),
      primary: bindLiveHandler(latestConfig.primary),
      tools: latestConfig.tools.map(bindLiveHandler),
    });
  }, [configKey, setConfig]);

  useEffect(() => {
    return () => {
      setConfig(null);
    };
  }, [setConfig]);
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

export function useDockActions(actions: DockAction[] | null): void {
  const { setActions } = useDockContext();
  const actionsKey = actions ? actions.map((action) => action.id).join(",") : "";

  useEffect(() => {
    setActions(actions);
  }, [actionsKey, setActions]);

  useEffect(() => {
    return () => {
      setActions(null);
    };
  }, [setActions]);
}
