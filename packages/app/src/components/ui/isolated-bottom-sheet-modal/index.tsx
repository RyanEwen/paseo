import { isWeb } from "@/constants/platform";
import { View, StyleSheet } from "react-native";
import { useWebOverlayPresentationLifetime } from "@/lib/overlay-presentation-lifetime";
import {
  BottomSheetModal as GorhomBottomSheetModal,
  type BottomSheetModalProps,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import type { ElementRef, ReactNode, RefObject } from "react";
import { systemBackPress } from "./back-press";
import {
  type BottomSheetController,
  createBottomSheetVisibilityTracker,
} from "./visibility-tracker";
import { BottomSheetScope } from "@/components/ui/bottom-sheet-scope";
import { SheetBackdrop } from "./sheet-backdrop";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

/**
 * Re-establishes React context on the far side of the portal.
 *
 * `@gorhom/portal` is not a React portal. It stores the element and a host elsewhere in the tree
 * renders it, so context resolves at the *host's* position: everything provided between
 * `PortalProvider` (see `app/_layout.tsx`) and this sheet is invisible to its content. React
 * cannot copy contexts reflectively, so the only way across is to render the providers again —
 * with values captured out here, where they are still readable.
 *
 * Write it as a closure over what you already have:
 *
 * ```tsx
 * const contextBridge = useCallback<ContextBridge>(
 *   (content) => <ThingContext.Provider value={thing}>{content}</ThingContext.Provider>,
 *   [thing],
 * );
 * ```
 */
export type ContextBridge = (children: ReactNode) => ReactNode;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior" | "children" | "backdropComponent"
> & {
  /**
   * Nodes only. Gorhom also accepts a render function, but nothing here uses it and a bridge
   * would have to reach around it.
   */
  children?: ReactNode;
  presentation?: "push" | "replace";
  /** Show a dismissible backdrop. Its interaction belongs to the modal stack. */
  backdropOpacity?: number;
  /** Explicit blocking web sheet opt-in; native/plain web have no installed guard. */
  nativeBrowserOverlap?: boolean;
  /**
   * Required, and `null` is a real answer: a sheet that needs nothing from its call site should
   * have to say so. The failure it prevents is invisible until someone adds a `useContext` deep
   * inside the sheet and it throws on device only.
   */
  contextBridge: ContextBridge | null;
};

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

interface SheetPresentationRequest {
  args: Parameters<GorhomBottomSheetModalMethods["present"]>;
  forwarded: boolean;
  committed: boolean;
}

/** Acquire before public present(): INITIAL Gorhom has no inner ref to close.
 * Once forwarded, normal framework dismissal owns its real portal/animation. */
function useWebSheetPresentation(
  modalRef: RefObject<GorhomBottomSheetModalMethods | null>,
  optionsRef: RefObject<IsolatedBottomSheetModalProps>,
) {
  const current = useRef<SheetPresentationRequest | null>(null);
  const [request, setRequest] = useState<SheetPresentationRequest | null>(null);
  const finishRequest = useCallback((finished: SheetPresentationRequest) => {
    if (current.current !== finished) return;
    current.current = null;
    setRequest(null);
  }, []);
  const dismiss = useCallback(
    (...args: Parameters<GorhomBottomSheetModalMethods["dismiss"]>) => {
      if (!isWeb || !optionsRef.current.nativeBrowserOverlap) {
        modalRef.current?.dismiss(...args);
        return;
      }
      const pending = current.current;
      if (!pending) return;
      if (pending.forwarded) {
        modalRef.current?.dismiss(...args);
        return;
      }
      // No framework present/RAF/provider entry exists yet. Cancel synchronously
      // before notifying the existing visibility tracker, which owns onClose.
      finishRequest(pending);
      optionsRef.current.onDismiss?.();
    },
    [finishRequest, modalRef, optionsRef],
  );
  const { ready, retainNode } = useWebOverlayPresentationLifetime({
    active: isWeb && Boolean(optionsRef.current.nativeBrowserOverlap) && request !== null,
    nativeBrowserOverlap: true,
    identity: request,
    onAdmissionFailed: dismiss,
  });
  const retain = useRef(retainNode);
  retain.current = retainNode;
  const retainContainerNode = useCallback((node: unknown) => retain.current(node), []);
  const AdmissionContainer = useMemo(
    () =>
      function SheetPresentationContainer({ children }: React.PropsWithChildren) {
        const owner = current.current;
        useLayoutEffect(() => {
          if (owner) owner.committed = true;
          return () => {
            if (owner) {
              owner.committed = false;
              finishRequest(owner);
            }
          };
        }, [owner]);
        const ParentContainer = optionsRef.current.containerComponent;
        // Do not unmount an admitted BottomSheet on a later guard change: it must
        // retain its ref and real dismiss/exit path. This is the same lease's DOM.
        return (
          <View
            ref={retainContainerNode}
            collapsable={false}
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
          >
            {ParentContainer ? <ParentContainer>{children}</ParentContainer> : children}
          </View>
        );
      },
    [finishRequest, optionsRef, retainContainerNode],
  );
  useLayoutEffect(() => {
    if (!request || current.current !== request || request.forwarded || !ready) return;
    request.forwarded = true;
    modalRef.current?.present(...request.args);
  }, [modalRef, ready, request]);
  const present = useCallback(
    (...args: Parameters<GorhomBottomSheetModalMethods["present"]>) => {
      if (!isWeb || !optionsRef.current.nativeBrowserOverlap) {
        modalRef.current?.present(...args);
        return;
      }
      const pending = current.current;
      if (pending) {
        if (pending.forwarded) modalRef.current?.present(...args);
        else pending.args = args;
        return;
      }
      const next = { args, forwarded: false, committed: false };
      current.current = next;
      setRequest(next);
    },
    [modalRef, optionsRef],
  );
  const close = useCallback(
    (...args: Parameters<GorhomBottomSheetModalMethods["close"]>) => {
      if (
        isWeb &&
        optionsRef.current.nativeBrowserOverlap &&
        current.current &&
        !current.current.committed
      )
        dismiss();
      else modalRef.current?.close(...args);
    },
    [dismiss, modalRef, optionsRef],
  );
  const forceClose = useCallback(
    (...args: Parameters<GorhomBottomSheetModalMethods["forceClose"]>) => {
      if (
        isWeb &&
        optionsRef.current.nativeBrowserOverlap &&
        current.current &&
        !current.current.committed
      )
        dismiss();
      else modalRef.current?.forceClose(...args);
    },
    [dismiss, modalRef, optionsRef],
  );
  const onDismiss = useCallback(() => {
    // Bind the callback to the request rendered into this framework generation.
    // Retirement precedes caller code, which may immediately present again.
    if (isWeb && optionsRef.current.nativeBrowserOverlap) {
      if (!request || current.current !== request) return;
      finishRequest(request);
    }
    optionsRef.current.onDismiss?.();
  }, [finishRequest, optionsRef, request]);
  return { present, dismiss, close, forceClose, onDismiss, AdmissionContainer };
}

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  // Gorhom puts this ref into its provider queue and reads `.current` for stack operations.
  // A callback ref accepts the handle but leaves that queue unable to dismiss or restore it.
  const modalRef = useRef<GorhomBottomSheetModalMethods>(null);
  const optionsRef = useRef(props);
  optionsRef.current = props;
  const { present, dismiss, close, forceClose, onDismiss, AdmissionContainer } =
    useWebSheetPresentation(modalRef, optionsRef);
  useImperativeHandle(
    ref,
    () => ({
      present,
      dismiss,
      snapToIndex: (...args) => modalRef.current?.snapToIndex(...args),
      snapToPosition: (...args) => modalRef.current?.snapToPosition(...args),
      expand: (...args) => modalRef.current?.expand(...args),
      collapse: (...args) => modalRef.current?.collapse(...args),
      close,
      forceClose,
    }),
    [present, dismiss, close, forceClose],
  );
  const {
    children,
    presentation = "push",
    contextBridge,
    backdropOpacity,
    nativeBrowserOverlap = false,
    containerComponent,
    ...bottomSheetProps
  } = props;
  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <SheetBackdrop {...backdropProps} opacity={backdropOpacity} />
    ),
    [backdropOpacity],
  );
  const modal = (
    <GorhomBottomSheetModal
      {...bottomSheetProps}
      containerComponent={nativeBrowserOverlap && isWeb ? AdmissionContainer : containerComponent}
      ref={modalRef}
      onDismiss={onDismiss}
      enableDismissOnClose
      stackBehavior={presentation}
      backdropComponent={backdropOpacity === undefined ? undefined : renderBackdrop}
    >
      <BottomSheetScope>{contextBridge ? contextBridge(children) : children}</BottomSheetScope>
    </GorhomBottomSheetModal>
  );

  return modal;
});

export function useIsolatedBottomSheetVisibility({
  visible,
  isEnabled,
  onClose,
}: {
  visible: boolean;
  isEnabled?: boolean;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const tracker = useMemo(
    () =>
      createBottomSheetVisibilityTracker({
        onClose: () => onCloseRef.current(),
        backPress: systemBackPress,
      }),
    [],
  );

  const setSheetRef = useCallback(
    (instance: IsolatedBottomSheetModalRef | null) => {
      tracker.attachController(instance as BottomSheetController | null);
    },
    [tracker],
  );

  const handleSheetChange = useCallback(
    (index: number) => tracker.handleSheetIndexChange(index),
    [tracker],
  );

  const handleSheetDismiss = useCallback(() => tracker.handleSheetDismiss(), [tracker]);

  useEffect(() => {
    tracker.syncDesired({ visible, isEnabled });
  }, [isEnabled, tracker, visible]);

  return {
    sheetRef: setSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  };
}
