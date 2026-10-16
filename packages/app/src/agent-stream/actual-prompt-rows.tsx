import {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ActualPromptRows {
  scope: string;
  expandedIds: ReadonlySet<string>;
  toggleExpanded(id: string): void;
  expand(id: string): void;
  availableHeight: number;
  reportViewportHeight(height: number): void;
  registerViewport(prepare: (id: string) => void): () => void;
}

export const ActualPinnedRowContext = createContext(false);

export const ActualPromptRowsContext = createContext<ActualPromptRows | null>(null);

/** Disclosure belongs to the message, not its current live/history or virtual lane. */
export function ActualPromptRowsProvider({
  enabled,
  scope,
  availableHeight,
  children,
}: {
  enabled: boolean;
  scope: string;
  availableHeight: number;
  children: ReactNode;
}) {
  const [pane, setPane] = useState({ scope, height: availableHeight });
  const reportViewportHeight = useCallback(
    (height: number) => {
      if (!(height > 0)) return;
      setPane((current) =>
        current.scope === scope && current.height === height ? current : { scope, height },
      );
    },
    [scope],
  );
  const measuredHeight = pane.scope === scope ? pane.height : availableHeight;
  const viewportHeight =
    availableHeight > 0 && measuredHeight > 0
      ? Math.min(availableHeight, measuredHeight)
      : Math.max(availableHeight, measuredHeight);
  const viewportOwner = useRef<((id: string) => void) | null>(null);
  const registerViewport = useCallback((prepare: (id: string) => void) => {
    viewportOwner.current = prepare;
    return () => {
      if (viewportOwner.current === prepare) viewportOwner.current = null;
    };
  }, []);
  const [state, setState] = useState(() => ({ scope, expandedIds: new Set<string>() }));
  useLayoutEffect(() => {
    setState((current) =>
      current.scope === scope ? current : { scope, expandedIds: new Set<string>() },
    );
  }, [scope]);
  const expandedIds = useMemo(
    () => (state.scope === scope ? state.expandedIds : new Set<string>()),
    [scope, state],
  );
  const toggleExpanded = useCallback(
    (id: string) => {
      viewportOwner.current?.(id);
      setState((current) => {
        const ids = new Set(current.scope === scope ? current.expandedIds : []);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        return { scope, expandedIds: ids };
      });
    },
    [scope],
  );
  const expand = useCallback(
    (id: string) => {
      viewportOwner.current?.(id);
      setState((current) => {
        if (current.scope === scope && current.expandedIds.has(id)) return current;
        const ids = new Set(current.scope === scope ? current.expandedIds : []);
        ids.add(id);
        return { scope, expandedIds: ids };
      });
    },
    [scope],
  );
  const value = useMemo(
    () =>
      enabled
        ? {
            scope,
            expandedIds,
            toggleExpanded,
            expand,
            availableHeight: viewportHeight,
            reportViewportHeight,
            registerViewport,
          }
        : null,
    [
      enabled,
      scope,
      expandedIds,
      toggleExpanded,
      expand,
      viewportHeight,
      reportViewportHeight,
      registerViewport,
    ],
  );
  return (
    <ActualPromptRowsContext.Provider value={value}>{children}</ActualPromptRowsContext.Provider>
  );
}
