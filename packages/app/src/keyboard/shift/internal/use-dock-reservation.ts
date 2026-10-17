import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardController, useGenericKeyboardHandler } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveDockReservation, updateDockReservation } from "./policy";

/** Same endpoint geometry as physical K, including accessory heights on iOS.
 * Only keyboard start/end publish React layout; animation remains on its native driver. */
export function usePublishDockReservation(enabled: boolean, bottomClearance: number) {
  const { bottom } = useSafeAreaInsets();
  const [reservation, setReservation] = useState(() => ({
    extent:
      enabled && KeyboardController.isVisible()
        ? resolveDockReservation(KeyboardController.state().height, 1, bottom, bottomClearance)
        : 0,
    settledRevision: 0,
  }));
  const latest = useRef({ enabled, bottom, bottomClearance });
  latest.current = { enabled, bottom, bottomClearance };
  const moving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const publish = useCallback((height: number, progress: number, starting: boolean) => {
    if (!mounted.current) return;
    moving.current = starting;
    const config = latest.current;
    const target =
      config.enabled && progress > 0
        ? resolveDockReservation(height, progress, config.bottom, config.bottomClearance)
        : 0;
    setReservation((previous) =>
      updateDockReservation(previous, target, starting ? "start" : "end"),
    );
  }, []);
  useEffect(() => {
    const visible = KeyboardController.isVisible();
    const target =
      enabled && visible
        ? resolveDockReservation(KeyboardController.state().height, 1, bottom, bottomClearance)
        : 0;
    setReservation((previous) => {
      if (moving.current) return updateDockReservation(previous, target, "start");
      if (previous.extent === target) return previous;
      return { ...previous, extent: target };
    });
  }, [enabled, bottom, bottomClearance]);
  useGenericKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        scheduleOnRN(publish, event.height, event.height > 0 ? 1 : 0, true);
      },
      onEnd: (event) => {
        "worklet";
        scheduleOnRN(publish, event.height, event.progress, false);
      },
    },
    [publish],
  );
  return useMemo(
    () => (enabled ? reservation : { ...reservation, extent: 0 }),
    [enabled, reservation],
  );
}
