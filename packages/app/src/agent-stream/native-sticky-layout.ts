/** The RN sticky wrapper owns absolute L. Its nested cell's native y is local0.
 * Deliver each actual wrapper layout once to the existing VirtualizedList cell
 * callback. A fresh position identity gets a fresh channel, never stale replay. */
export function createNativeStickyLayout<T>(position?: {
  key: unknown;
  index: number | undefined;
}) {
  let latest: { event: T; revision: number } | null = null;
  let revision = 0;
  const subscribers = new Map<(event: T) => void, number>();
  function deliver(callback: (event: T) => void) {
    if (!latest || subscribers.get(callback) === latest.revision) return;
    subscribers.set(callback, latest.revision);
    callback(latest.event);
  }
  return {
    position,
    publish(event: T) {
      latest = { event, revision: ++revision };
      for (const callback of subscribers.keys()) deliver(callback);
    },
    subscribe(callback: (event: T) => void) {
      subscribers.set(callback, -1);
      deliver(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
}
