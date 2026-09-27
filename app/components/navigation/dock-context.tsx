import {
  createContext,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
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
  /**
   * Optional click handler for a link item (`onAction` is an href). The item stays a real
   * link; the handler may call `event.preventDefault()` to navigate differently, as the
   * recipe Back item does to return to the previous in-app page.
   */
  onLinkClick?: (event: MouseEvent<HTMLElement>) => void;
  active?: boolean;
  /** For a button that shows and hides another element: whether that element is showing. */
  expanded?: boolean;
  /** For a button that shows and hides another element: that element's id. */
  controls?: string;
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

function dockButtons(config: DockConfig | null): DockButton[] {
  return config ? [config.left, config.primary, ...config.tools] : [];
}

/** Everything the dock shows or links to for a button; handlers are left out. */
function buttonSignature(button: DockButton): unknown[] {
  return [
    button.id,
    button.icon,
    button.label,
    button.sublabel,
    button.ariaLabel,
    typeof button.onAction === "string" ? button.onAction : null,
    Boolean(button.onLinkClick),
    button.active,
    button.expanded,
    button.controls,
    button.tone,
    button.iconClassName,
    button.labelClassName,
  ];
}

function configSignature(config: DockConfig | null): unknown[] | null {
  if (!config) return null;
  return [config.variant, config.ariaLabel, ...dockButtons(config).flatMap(buttonSignature)];
}

function sameSignature(a: unknown[] | null, b: unknown[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Registers the page's dock. The dock is re-registered only when something it shows changes
 * (ids, labels, icons, hrefs), so callers need not memoize. Handlers are registered as stable
 * wrappers that call the button's handler from the page's latest render, so a handler that
 * closes over page state (the recipe's current scale, say) is never stale.
 *
 * Icons are compared by reference, so each button's `icon` must be a stable component (defined
 * at module level, as the lucide icons are), never a component created during render: a new
 * icon on every render would re-register the dock on every render, and each registration
 * re-renders the page, so it would loop.
 */
export function useDockConfig(config: DockConfig | null): void {
  const { setConfig } = useDockContext();
  const latestConfig = useRef(config);
  const registeredSignature = useRef<unknown[] | null | undefined>(undefined);

  useEffect(() => {
    latestConfig.current = config;
  });

  useEffect(() => {
    const signature = configSignature(config);
    if (registeredSignature.current !== undefined && sameSignature(registeredSignature.current, signature)) {
      return;
    }
    registeredSignature.current = signature;

    const latestButton = (id: string) => dockButtons(latestConfig.current).find((button) => button.id === id);
    const withLatestHandlers = (button: DockButton): DockButton => ({
      ...button,
      onAction: typeof button.onAction === "function"
        ? () => {
            const handler = latestButton(button.id)?.onAction;
            if (typeof handler === "function") handler();
          }
        : button.onAction,
      onLinkClick: button.onLinkClick
        ? (event) => latestButton(button.id)?.onLinkClick?.(event)
        : undefined,
    });

    setConfig(config
      ? {
          ...config,
          left: withLatestHandlers(config.left),
          primary: withLatestHandlers(config.primary),
          tools: config.tools.map(withLatestHandlers),
        }
      : null);
  });

  useEffect(() => {
    return () => {
      registeredSignature.current = undefined;
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
