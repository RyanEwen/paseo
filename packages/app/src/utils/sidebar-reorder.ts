export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}

/**
 * Separate project pin drags from ordinary ordering. Return no ordinary update when only pins
 * moved, preserving both the selected sort mode and hidden siblings' saved positions.
 */
export function resolveProjectWorkspaceReorder(input: {
  currentVisibleKeys: string[];
  reorderedVisibleKeys: string[];
  projectPinnedKeys: ReadonlySet<string>;
  storedWorkspaceOrder: string[];
}): { projectPinKeys: string[]; workspaceOrder: string[] | null } {
  const ordinaryKeys = input.reorderedVisibleKeys.filter(
    (key) => !input.projectPinnedKeys.has(key),
  );
  const ordinaryOrderChanged = hasVisibleOrderChanged({
    currentOrder: input.currentVisibleKeys.filter((key) => !input.projectPinnedKeys.has(key)),
    reorderedVisibleKeys: ordinaryKeys,
  });
  return {
    projectPinKeys: input.reorderedVisibleKeys.filter((key) => input.projectPinnedKeys.has(key)),
    workspaceOrder: ordinaryOrderChanged
      ? mergeWithRemainder({
          currentOrder: input.storedWorkspaceOrder,
          reorderedVisibleKeys: ordinaryKeys,
        })
      : null,
  };
}
